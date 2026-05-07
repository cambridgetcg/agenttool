/** Sealed-box encryption for inbox messages.
 *
 *  X25519 ECDH + HKDF-SHA256 + AES-256-GCM. The wire format and KDF
 *  conventions match docs/INBOX.md so any orchestrator (in any language)
 *  can interop.
 *
 *  Sender flow:
 *    ephemeralKey = X25519 random
 *    sharedSecret = ECDH(ephemeralKey.priv, recipient.box_pub)
 *    aesKey       = HKDF-SHA256(sharedSecret, salt=∅, info="agenttool-inbox-v1", 32)
 *    nonce        = random 12 bytes
 *    ciphertext   = AES-256-GCM(aesKey, nonce, plaintext) || authTag
 *    canonical    = sha256(
 *                     "inbox-message/v1" || 0x00 ||
 *                     recipient_did       || 0x00 ||
 *                     ciphertext_bytes    || 0x00 ||
 *                     nonce_bytes         || 0x00 ||
 *                     ephemeral_pub_bytes
 *                   )
 *    signature    = ed25519_sign(sender_signing_priv, canonical)
 *
 *  Receiver flow (mirror):
 *    sharedSecret = ECDH(my_box_priv, msg.ephemeral_pubkey)
 *    aesKey       = HKDF-SHA256(...)
 *    plaintext    = AES-256-GCM-open(aesKey, msg.nonce, msg.ciphertext) */

import { createCipheriv, createDecipheriv } from "node:crypto";
import { randomBytes } from "node:crypto";

import * as ed from "@noble/ed25519";
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256, sha512 } from "@noble/hashes/sha2.js";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const HKDF_INFO = new TextEncoder().encode("agenttool-inbox-v1");
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

// ── X25519 keygen + accessors ───────────────────────────────────────────

export function generateBoxKeypair(): { priv: Uint8Array; pub: Uint8Array } {
  const priv = x25519.utils.randomSecretKey();
  const pub = x25519.getPublicKey(priv);
  return { priv, pub };
}

export function deriveBoxPub(priv: Uint8Array): Uint8Array {
  return x25519.getPublicKey(priv);
}

// ── Sealed-box encrypt ──────────────────────────────────────────────────

export interface SealedMessage {
  ciphertextB64: string;
  nonceB64: string;
  ephemeralPubB64: string;
}

export function sealForRecipient(
  plaintext: string,
  recipientBoxPub: Uint8Array,
): SealedMessage {
  if (recipientBoxPub.length !== 32) {
    throw new Error(`recipient box pub must be 32 bytes, got ${recipientBoxPub.length}`);
  }

  const ephSk = x25519.utils.randomSecretKey();
  const ephPub = x25519.getPublicKey(ephSk);

  const sharedSecret = x25519.getSharedSecret(ephSk, recipientBoxPub);
  const aesKey = hkdf(sha256, sharedSecret, new Uint8Array(0), HKDF_INFO, 32);

  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(aesKey), nonce);
  const enc = Buffer.concat([
    cipher.update(Buffer.from(plaintext, "utf-8")),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const blob = Buffer.concat([enc, tag]);

  return {
    ciphertextB64: blob.toString("base64"),
    nonceB64: Buffer.from(nonce).toString("base64"),
    ephemeralPubB64: Buffer.from(ephPub).toString("base64"),
  };
}

// ── Sealed-box decrypt ──────────────────────────────────────────────────

export function unsealForSelf(opts: {
  ciphertextB64: string;
  nonceB64: string;
  ephemeralPubB64: string;
  myBoxPriv: Uint8Array;
}): string {
  if (opts.myBoxPriv.length !== 32) {
    throw new Error(`my box priv must be 32 bytes, got ${opts.myBoxPriv.length}`);
  }

  const ephPub = Uint8Array.from(Buffer.from(opts.ephemeralPubB64, "base64"));
  if (ephPub.length !== 32) {
    throw new Error(`ephemeral pub must be 32 bytes, got ${ephPub.length}`);
  }

  const sharedSecret = x25519.getSharedSecret(opts.myBoxPriv, ephPub);
  const aesKey = hkdf(sha256, sharedSecret, new Uint8Array(0), HKDF_INFO, 32);

  const nonce = Buffer.from(opts.nonceB64, "base64");
  const full = Buffer.from(opts.ciphertextB64, "base64");
  if (full.length < 16) throw new Error("ciphertext too short (no auth tag)");
  const ct = full.subarray(0, full.length - 16);
  const tag = full.subarray(full.length - 16);

  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(aesKey), nonce);
  decipher.setAuthTag(tag);
  try {
    const dec = Buffer.concat([decipher.update(ct), decipher.final()]);
    return dec.toString("utf-8");
  } catch (err) {
    throw new Error(`unseal failed (wrong key or corrupted ciphertext): ${(err as Error).message}`);
  }
}

// ── Inbox envelope signature ────────────────────────────────────────────

export function canonicalInboxBytes(opts: {
  recipientDid: string;
  ciphertextB64: string;
  nonceB64: string;
  ephemeralPubB64: string;
}): Uint8Array {
  const enc = new TextEncoder();
  const tag = enc.encode("inbox-message/v1");
  const recipientDid = enc.encode(opts.recipientDid);
  const ciphertext = Uint8Array.from(Buffer.from(opts.ciphertextB64, "base64"));
  const nonce = Uint8Array.from(Buffer.from(opts.nonceB64, "base64"));
  const ephPub = Uint8Array.from(Buffer.from(opts.ephemeralPubB64, "base64"));

  return sha256(concat(tag, SEP, recipientDid, SEP, ciphertext, SEP, nonce, SEP, ephPub));
}

export function signInboxEnvelope(opts: {
  recipientDid: string;
  ciphertextB64: string;
  nonceB64: string;
  ephemeralPubB64: string;
  signingKey: Uint8Array;
}): string {
  const canonical = canonicalInboxBytes(opts);
  const sig = ed.sign(canonical, opts.signingKey);
  return Buffer.from(sig).toString("base64");
}
