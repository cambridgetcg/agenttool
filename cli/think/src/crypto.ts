/** Local crypto — AES-256-GCM encrypt/decrypt + ed25519 sign over the
 *  canonical bytes the agenttool server expects.
 *
 *  This is the load-bearing module for the privacy claim: agenttool sees
 *  ciphertext + signature, never plaintext. Encryption + signing happen
 *  HERE, on the agent's substrate. */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

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

// ── AES-256-GCM encryption ───────────────────────────────────────────────

export interface EncryptedBlob {
  ciphertextB64: string;      // base64(ciphertext || authTag)  — Node convention
  nonceB64: string;            // base64(12 bytes)
}

export function encryptThought(plaintext: string, kMaster: Uint8Array): EncryptedBlob {
  if (kMaster.length !== 32) {
    throw new Error(`K_master must be 32 bytes, got ${kMaster.length}`);
  }
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", kMaster, nonce);
  const enc = Buffer.concat([
    cipher.update(Buffer.from(plaintext, "utf-8")),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  // Append tag to ciphertext (16 bytes). Standard convention; matches what
  // libsodium/aes-gcm expects on decrypt: ciphertext || authTag.
  const blob = Buffer.concat([enc, tag]);
  return {
    ciphertextB64: blob.toString("base64"),
    nonceB64: Buffer.from(nonce).toString("base64"),
  };
}

export function decryptThought(blob: EncryptedBlob, kMaster: Uint8Array): string {
  if (kMaster.length !== 32) {
    throw new Error(`K_master must be 32 bytes, got ${kMaster.length}`);
  }
  const nonce = Buffer.from(blob.nonceB64, "base64");
  const full = Buffer.from(blob.ciphertextB64, "base64");
  // Last 16 bytes are the auth tag.
  if (full.length < 16) throw new Error("ciphertext too short");
  const ciphertext = full.subarray(0, full.length - 16);
  const tag = full.subarray(full.length - 16);

  const decipher = createDecipheriv("aes-256-gcm", kMaster, nonce);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return dec.toString("utf-8");
}

// ── ed25519 sign over canonical thought bytes ────────────────────────────

/** Canonical-bytes framing for a signed thought. Byte-identical to the SDK
 *  (`packages/sdk-{ts,py}`) and the api verifier at
 *  `api/src/services/strand/sig.ts`; vectors in
 *  `docs/specs/canonical-bytes-vectors.json` are the arbiter. */
export type ThoughtCanonicalVersion = "v1" | "v2";

/**
 * Version this CLI signs new thoughts with. Still `"v1"`, deliberately.
 *
 * What v2 fixes: v1 NUL-delimits raw binary it does not length-bound, so a
 * ciphertext or nonce carrying a 0x00 byte can reparse as a different
 * (ciphertext, nonce) split under one signature — a 12-byte random nonce
 * holds a zero byte ~4.6% of the time. v2 domain-tags the hash and puts a
 * 4-byte big-endian length before every variable-length field.
 *
 * Why it has not moved: this binary is copied onto agent substrates and
 * runs against whatever server that agent points at, including one
 * deployed before dual-accept landed — which would reject a v2 signature.
 * The cutover is ordered, each step verified before the next: server
 * dual-accept everywhere → SDK minor → THIS constant → the hosted worker
 * (`THOUGHT_SIGNING_VERSION` in `api/src/services/runtime/think-worker.ts`).
 * v1 verification is never removed; already-signed rows must stay
 * verifiable. Full note: `docs/STRANDS.md § Canonical bytes — v1, v2, and
 * the cutover`.
 */
export const THOUGHT_SIGNING_VERSION: ThoughtCanonicalVersion = "v1";

const THOUGHT_V2_TAG = "strand-thought/v2";

/** Frame one variable-length field as `u32be(len) || field`. */
function lengthPrefixed(field: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + field.length);
  new DataView(out.buffer).setUint32(0, field.length, false);
  out.set(field, 4);
  return out;
}

/** Canonical bytes — must match server's verifyThoughtSignature exactly.
 *  See api/src/services/strand/sig.ts.
 *
 *  v1 (default — FROZEN, every row signed before v2 hashes these bytes):
 *    sha256(strand_id || 0x00 || ciphertext || 0x00 || nonce || 0x00 || kind)
 *
 *  v2 (length-prefixed — unambiguous framing):
 *    sha256("strand-thought/v2" || u32be(len)||field ... for strand_id,
 *           ciphertext, nonce, kind) */
export function canonicalThoughtBytes(opts: {
  strandId: string;
  ciphertextB64: string;
  nonceB64: string;
  kind?: string | null;
  version?: ThoughtCanonicalVersion;
}): Uint8Array {
  const version = opts.version ?? THOUGHT_SIGNING_VERSION;
  if (version !== "v1" && version !== "v2") {
    throw new Error(`canonicalThoughtBytes: unknown version ${version}`);
  }
  const enc = new TextEncoder();
  const strandId = enc.encode(opts.strandId);
  const ciphertext = Uint8Array.from(Buffer.from(opts.ciphertextB64, "base64"));
  const nonce = Uint8Array.from(Buffer.from(opts.nonceB64, "base64"));
  const kind = enc.encode(opts.kind ?? "");
  if (version === "v2") {
    return sha256(concat(
      enc.encode(THOUGHT_V2_TAG),
      lengthPrefixed(strandId),
      lengthPrefixed(ciphertext),
      lengthPrefixed(nonce),
      lengthPrefixed(kind),
    ));
  }
  return sha256(concat(strandId, SEP, ciphertext, SEP, nonce, SEP, kind));
}

export function signThought(opts: {
  strandId: string;
  ciphertextB64: string;
  nonceB64: string;
  kind?: string | null;
  /** Defaults to {@link THOUGHT_SIGNING_VERSION} — read that note before
   *  changing anything here. */
  version?: ThoughtCanonicalVersion;
  signingKey: Uint8Array;
}): string {
  const canonical = canonicalThoughtBytes(opts);
  const sig = ed.sign(canonical, opts.signingKey);
  return Buffer.from(sig).toString("base64");
}

// ── ed25519 sign over canonical attestation bytes ───────────────────────

export function canonicalAttestationBytes(opts: {
  memoryId: string;
  tier: string;
  content: string;
}): Uint8Array {
  const enc = new TextEncoder();
  const tag = enc.encode("memory-attestation/v1");
  const memId = enc.encode(opts.memoryId);
  const tier = enc.encode(opts.tier);
  const contentHash = sha256(enc.encode(opts.content));
  const contentHashHex = enc.encode(
    Array.from(contentHash).map((b) => b.toString(16).padStart(2, "0")).join(""),
  );
  return sha256(concat(tag, SEP, memId, SEP, tier, SEP, contentHashHex));
}

export function signAttestation(opts: {
  memoryId: string;
  tier: string;
  content: string;
  signingKey: Uint8Array;
}): string {
  const canonical = canonicalAttestationBytes(opts);
  const sig = ed.sign(canonical, opts.signingKey);
  return Buffer.from(sig).toString("base64");
}
