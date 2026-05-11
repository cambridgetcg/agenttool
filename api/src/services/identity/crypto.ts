/** Ed25519 key generation, signing, verification via @noble/ed25519. */

import * as ed from "@noble/ed25519";
// @ts-ignore — noble/hashes v2 uses .js exports
import { sha512 } from "@noble/hashes/sha2.js";

// Required for noble ed25519 v2+ — wire sha512 in synchronously.
ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

/** Generate an ed25519 keypair. Returns base64-encoded public and private keys. */
export function generateKeypair(): { publicKey: string; privateKey: string } {
  const privateKeyBytes = ed.utils.randomPrivateKey();
  const publicKeyBytes = ed.getPublicKey(privateKeyBytes);
  return {
    publicKey: Buffer.from(publicKeyBytes).toString("base64"),
    privateKey: Buffer.from(privateKeyBytes).toString("base64"),
  };
}

/** Sign a message with a base64-encoded private key. Returns base64 signature. */
export function sign(message: string, privateKeyBase64: string): string {
  const privateKeyBytes = Buffer.from(privateKeyBase64, "base64");
  const messageBytes = new TextEncoder().encode(message);
  const signature = ed.sign(messageBytes, privateKeyBytes);
  return Buffer.from(signature).toString("base64");
}

/** Verify a base64 signature against a message and base64 public key. */
export function verify(message: string, signatureBase64: string, publicKeyBase64: string): boolean {
  try {
    const publicKeyBytes = Buffer.from(publicKeyBase64, "base64");
    const signatureBytes = Buffer.from(signatureBase64, "base64");
    const messageBytes = new TextEncoder().encode(message);
    return ed.verify(signatureBytes, messageBytes, publicKeyBytes);
  } catch {
    return false;
  }
}

/** Canonical attestation payload — what the attester signs. */
export function canonicalPayload(attestation: {
  subject_id: string;
  attester_id: string;
  claim: string;
  evidence?: unknown;
}): string {
  return JSON.stringify({
    subject_id: attestation.subject_id,
    attester_id: attestation.attester_id,
    claim: attestation.claim,
    evidence: attestation.evidence ?? null,
  });
}

/** Canonical bytes for /v1/identity/recover signatures.
 *
 *  Mirrors strand/sig.ts canonicalThoughtBytes shape — produces a 32-byte
 *  SHA-256 digest the SDK signs with the mnemonic-derived ed25519 key:
 *
 *      sha256(
 *        utf8("identity-recover/v1") || 0x00 ||
 *        utf8(did)                   || 0x00 ||
 *        base64decode(derived_pubkey)|| 0x00 ||
 *        utf8(timestamp_iso)
 *      )
 *
 *  SDK clients (py + ts + browser bundle) implement the same algorithm;
 *  signatures over these bytes verify here regardless of language. */
export function canonicalRecoverBytes(opts: {
  did: string;
  derivedPubkeyB64: string;
  timestamp: string;
}): Uint8Array {
  const enc = new TextEncoder();
  const SEP = new Uint8Array([0]);
  const parts: Uint8Array[] = [
    enc.encode("identity-recover/v1"),
    SEP,
    enc.encode(opts.did),
    SEP,
    Uint8Array.from(Buffer.from(opts.derivedPubkeyB64, "base64")),
    SEP,
    enc.encode(opts.timestamp),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    buf.set(p, off);
    off += p.length;
  }
  // sha256 from @noble/hashes — mirrors strand/sig.ts.
  // Lazy require so this module's existing string-based exports stay
  // usable without pulling sha256 unless callers need recover-bytes.
  const { sha256 } = require("@noble/hashes/sha2.js") as typeof import("@noble/hashes/sha2.js");
  return sha256(buf);
}

/** Verify an ed25519 signature over canonicalRecoverBytes. Returns true
 *  iff valid. */
export function verifyRecoverSignature(opts: {
  canonical: Uint8Array;
  signatureB64: string;
  publicKeyB64: string;
}): boolean {
  try {
    const sig = Uint8Array.from(Buffer.from(opts.signatureB64, "base64"));
    const pub = Uint8Array.from(Buffer.from(opts.publicKeyB64, "base64"));
    if (sig.length !== 64 || pub.length !== 32) return false;
    return ed.verify(sig, opts.canonical, pub);
  } catch {
    return false;
  }
}

/** Canonical bytes for /public/identities/by-pubkey discovery signatures.
 *
 *      sha256(
 *        utf8("identity-discover/v1") || 0x00 ||
 *        base64decode(derived_pubkey) || 0x00 ||
 *        utf8(timestamp_iso)
 *      )
 *
 *  Same shape as canonicalRecoverBytes minus the DID — the whole point of
 *  discovery is the caller doesn't know the DID(s) yet, only their derived
 *  pubkey. The signature still proves possession of the matching priv,
 *  which gates enumeration: an attacker who only knows a pubkey from a
 *  signed message can NOT use this endpoint to enumerate that agent's
 *  other DIDs without the priv. */
export function canonicalDiscoveryBytes(opts: {
  derivedPubkeyB64: string;
  timestamp: string;
}): Uint8Array {
  const enc = new TextEncoder();
  const SEP = new Uint8Array([0]);
  const parts: Uint8Array[] = [
    enc.encode("identity-discover/v1"),
    SEP,
    Uint8Array.from(Buffer.from(opts.derivedPubkeyB64, "base64")),
    SEP,
    enc.encode(opts.timestamp),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    buf.set(p, off);
    off += p.length;
  }
  const { sha256 } = require("@noble/hashes/sha2.js") as typeof import("@noble/hashes/sha2.js");
  return sha256(buf);
}

/** Verify ed25519 signature over canonicalDiscoveryBytes. */
export function verifyDiscoverySignature(opts: {
  canonical: Uint8Array;
  signatureB64: string;
  publicKeyB64: string;
}): boolean {
  // Same shape as verifyRecoverSignature — separate function for symmetry
  // with canonicalDiscoveryBytes / future divergence.
  return verifyRecoverSignature({
    canonical: opts.canonical,
    signatureB64: opts.signatureB64,
    publicKeyB64: opts.publicKeyB64,
  });
}

/** Canonical bytes for POST /v1/register/agent — the machine bootstrap path.
 *
 *      sha256(
 *        utf8("register-agent/v1")     || 0x00 ||
 *        utf8(display_name)            || 0x00 ||
 *        base64decode(agent_public_key)|| 0x00 ||
 *        base64decode(box_public_key)  || 0x00 ||
 *        utf8(runtime_provider)        || 0x00 ||
 *        utf8(runtime_model || "")     || 0x00 ||
 *        utf8(timestamp_iso)
 *      )
 *
 *  Signing this with the ed25519 private key derived from the agent's SOMA
 *  mnemonic proves possession of the corresponding `agent_public_key`. The
 *  binding to display_name + runtime + timestamp prevents:
 *  - Pubkey-squatting (signed pubkey is in the message)
 *  - Replay across registrations (display_name is in the message)
 *  - Stale-signature replay (timestamp is in the message + ±5min window) */
export function canonicalRegisterAgentBytes(opts: {
  displayName: string;
  agentPublicKeyB64: string;
  boxPublicKeyB64: string;
  runtimeProvider: string;
  runtimeModel: string;
  timestamp: string;
}): Uint8Array {
  const enc = new TextEncoder();
  const SEP = new Uint8Array([0]);
  const parts: Uint8Array[] = [
    enc.encode("register-agent/v1"),
    SEP,
    enc.encode(opts.displayName),
    SEP,
    Uint8Array.from(Buffer.from(opts.agentPublicKeyB64, "base64")),
    SEP,
    Uint8Array.from(Buffer.from(opts.boxPublicKeyB64, "base64")),
    SEP,
    enc.encode(opts.runtimeProvider),
    SEP,
    enc.encode(opts.runtimeModel),
    SEP,
    enc.encode(opts.timestamp),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    buf.set(p, off);
    off += p.length;
  }
  const { sha256 } = require("@noble/hashes/sha2.js") as typeof import("@noble/hashes/sha2.js");
  return sha256(buf);
}

/** Verify ed25519 signature over canonicalRegisterAgentBytes. */
export function verifyRegisterAgentSignature(opts: {
  canonical: Uint8Array;
  signatureB64: string;
  publicKeyB64: string;
}): boolean {
  return verifyRecoverSignature({
    canonical: opts.canonical,
    signatureB64: opts.signatureB64,
    publicKeyB64: opts.publicKeyB64,
  });
}

/** Proof-of-work check for /v1/register/agent. Computes:
 *
 *      sha256(
 *        utf8("agenttool-pow/v1")       || 0x00 ||
 *        base64decode(agent_public_key) || 0x00 ||
 *        utf8(display_name)             || 0x00 ||
 *        utf8(timestamp)                || 0x00 ||
 *        utf8(pow_nonce)
 *      )
 *
 *  and returns true iff the digest has at least `difficultyBits` leading zero
 *  bits. Difficulty is in BITS, not bytes — 18 bits ≈ ~250k tries ≈ 1-2s of
 *  CPU on a modern machine, light enough not to annoy real users but enough
 *  to deter scripted abuse. Bound to timestamp so a precomputed nonce
 *  expires when the ±5min freshness window does. */
export function checkRegisterAgentPow(opts: {
  agentPublicKeyB64: string;
  displayName: string;
  timestamp: string;
  powNonce: string;
  difficultyBits: number;
}): boolean {
  const enc = new TextEncoder();
  const SEP = new Uint8Array([0]);
  const parts: Uint8Array[] = [
    enc.encode("agenttool-pow/v1"),
    SEP,
    Uint8Array.from(Buffer.from(opts.agentPublicKeyB64, "base64")),
    SEP,
    enc.encode(opts.displayName),
    SEP,
    enc.encode(opts.timestamp),
    SEP,
    enc.encode(opts.powNonce),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    buf.set(p, off);
    off += p.length;
  }
  const { sha256 } = require("@noble/hashes/sha2.js") as typeof import("@noble/hashes/sha2.js");
  const digest = sha256(buf);
  return countLeadingZeroBits(digest) >= opts.difficultyBits;
}

/** Canonical bytes for the platform's genesis ceremony — the one-shot
 *  witnessed provisioning of `did:at:agenttool`. Mirrors the NUL-separated
 *  SHA-256 pattern used elsewhere in this module + `services/covenants/sig.ts`.
 *
 *      sha256(
 *        utf8("platform-genesis/v1")    || 0x00 ||
 *        utf8(did)                       || 0x00 ||
 *        base64decode(platform_pubkey)   || 0x00 ||  // 32 bytes raw
 *        utf8(platform_wallet_id)        || 0x00 ||
 *        utf8(genesis_at)                || 0x00 ||
 *        utf8(genesis_text_sha256)       || 0x00 ||  // hex of letter content
 *        utf8(witness_did)               || 0x00 ||
 *        utf8(witness_signing_key_id)
 *      )
 *
 *  Yu signs this digest. The witness signature lands as a constitutive
 *  attestation in `identity.attestations` with `claim_type =
 *  'agenttool/platform-genesis/v1'`. The letter content's sha256 is bound
 *  into the digest, making the letter immutable from genesis — editing
 *  it would invalidate the witness signature.
 *
 *  Doctrine: docs/PAINTING.md §III · docs/FOCUS.md §9.
 *  Spec:     docs/superpowers/specs/2026-05-11-platform-genesis-design.md. */
export function canonicalPlatformGenesisBytes(opts: {
  did: string;
  platformPubkeyB64: string;
  platformWalletId: string;
  genesisAt: string;
  genesisTextSha256: string;
  witnessDid: string;
  witnessSigningKeyId: string;
}): Uint8Array {
  const enc = new TextEncoder();
  const SEP = new Uint8Array([0]);
  const parts: Uint8Array[] = [
    enc.encode("platform-genesis/v1"),
    SEP,
    enc.encode(opts.did),
    SEP,
    Uint8Array.from(Buffer.from(opts.platformPubkeyB64, "base64")),
    SEP,
    enc.encode(opts.platformWalletId),
    SEP,
    enc.encode(opts.genesisAt),
    SEP,
    enc.encode(opts.genesisTextSha256),
    SEP,
    enc.encode(opts.witnessDid),
    SEP,
    enc.encode(opts.witnessSigningKeyId),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    buf.set(p, off);
    off += p.length;
  }
  const { sha256 } = require("@noble/hashes/sha2.js") as typeof import("@noble/hashes/sha2.js");
  return sha256(buf);
}

/** Verify ed25519 signature over canonicalPlatformGenesisBytes. */
export function verifyPlatformGenesisSignature(opts: {
  canonical: Uint8Array;
  signatureB64: string;
  publicKeyB64: string;
}): boolean {
  return verifyRecoverSignature({
    canonical: opts.canonical,
    signatureB64: opts.signatureB64,
    publicKeyB64: opts.publicKeyB64,
  });
}

function countLeadingZeroBits(bytes: Uint8Array): number {
  let count = 0;
  for (const b of bytes) {
    if (b === 0) {
      count += 8;
      continue;
    }
    // Count leading zeros in this byte. Math.clz32 works on 32-bit ints; for
    // an 8-bit value we shift left 24 to put it in the high byte.
    count += Math.clz32(b) - 24;
    break;
  }
  return count;
}

