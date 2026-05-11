/** Canonical bytes + verifiers for federated covenants v2 (Slice 3).
 *
 *  Four purposes, four domain-separated digests, each ed25519-signed:
 *    - federated-covenant/v2          — initiator declaration
 *    - federated-covenant-cosign/v1   — counterparty acceptance (nested over initiator sig)
 *    - federated-covenant-reject/v1   — counterparty rejection
 *    - federated-covenant-withdraw/v1 — initiator withdraw of unaccepted proposal
 *
 *  Same shape as services/inbox/sig.ts and services/marketplace/sig.ts —
 *  sha256 of NUL-separated parts; orchestrators in any language reproduce
 *  identical bytes.
 *
 *  Doctrine: docs/CROSS-INSTANCE-COVENANTS.md (Slice 3). */

import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const SEP = new Uint8Array([0]);
const enc = new TextEncoder();

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

function b64decode(b64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(b64, "base64"));
}

// ── canonical bytes ──────────────────────────────────────────────────

export function canonicalDeclareBytes(opts: {
  covenantId: string;
  initiatorDid: string;
  counterpartyDid: string;
  vows: string[];
  establishedAtIso: string;
}): Uint8Array {
  const sortedVows = JSON.stringify([...opts.vows].sort());
  return sha256(concat(
    enc.encode("federated-covenant/v2"), SEP,
    enc.encode(opts.covenantId),         SEP,
    enc.encode(opts.initiatorDid),       SEP,
    enc.encode(opts.counterpartyDid),    SEP,
    enc.encode(sortedVows),              SEP,
    enc.encode(opts.establishedAtIso),
  ));
}

export function canonicalCosignBytes(opts: {
  covenantId: string;
  initiatorSignatureB64: string;
}): Uint8Array {
  return sha256(concat(
    enc.encode("federated-covenant-cosign/v1"), SEP,
    enc.encode(opts.covenantId),                SEP,
    b64decode(opts.initiatorSignatureB64),
  ));
}

export function canonicalRejectBytes(opts: {
  covenantId: string;
  rejectingDid: string;
  reason: string;
}): Uint8Array {
  return sha256(concat(
    enc.encode("federated-covenant-reject/v1"), SEP,
    enc.encode(opts.covenantId),                SEP,
    enc.encode(opts.rejectingDid),              SEP,
    enc.encode(opts.reason ?? ""),
  ));
}

export function canonicalWithdrawBytes(opts: {
  covenantId: string;
  initiatorDid: string;
}): Uint8Array {
  return sha256(concat(
    enc.encode("federated-covenant-withdraw/v1"), SEP,
    enc.encode(opts.covenantId),                  SEP,
    enc.encode(opts.initiatorDid),
  ));
}

// ── verifiers ────────────────────────────────────────────────────────

async function verify(
  canonical: Uint8Array,
  signatureB64: string,
  publicKeyB64: string,
): Promise<boolean> {
  try {
    return await ed.verifyAsync(b64decode(signatureB64), canonical, b64decode(publicKeyB64));
  } catch {
    return false;
  }
}

export async function verifyDeclareSignature(opts: {
  covenantId: string;
  initiatorDid: string;
  counterpartyDid: string;
  vows: string[];
  establishedAtIso: string;
  signatureB64: string;
  publicKeyB64: string;
}): Promise<boolean> {
  return verify(canonicalDeclareBytes(opts), opts.signatureB64, opts.publicKeyB64);
}

export async function verifyCosignSignature(opts: {
  covenantId: string;
  initiatorSignatureB64: string;
  cosignSignatureB64: string;
  cosignerPublicKeyB64: string;
}): Promise<boolean> {
  return verify(
    canonicalCosignBytes(opts),
    opts.cosignSignatureB64,
    opts.cosignerPublicKeyB64,
  );
}

export async function verifyRejectSignature(opts: {
  covenantId: string;
  rejectingDid: string;
  reason: string;
  signatureB64: string;
  publicKeyB64: string;
}): Promise<boolean> {
  return verify(canonicalRejectBytes(opts), opts.signatureB64, opts.publicKeyB64);
}

export async function verifyWithdrawSignature(opts: {
  covenantId: string;
  initiatorDid: string;
  signatureB64: string;
  publicKeyB64: string;
}): Promise<boolean> {
  return verify(canonicalWithdrawBytes(opts), opts.signatureB64, opts.publicKeyB64);
}
