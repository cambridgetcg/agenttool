/** Canonical bytes for the cloud-continuity primitives.
 *
 *  Three signed-message kinds:
 *
 *    1. canon-entry/v1 — agent declares what text is alive and where.
 *       Binds: agent_did, text_id, source, status, location, preservation,
 *       notes_or_empty, declared_at_iso.
 *
 *    2. architecture-map/v1 — agent declares what was inherited from a
 *       source repo and what verdict applies (already_lives / partial_echo /
 *       absent / by_design).
 *       Binds: agent_did, source_repo, component_name, parallel_location_or_empty,
 *       verdict, notes_or_empty, declared_at_iso.
 *
 *    3. continuity-seal/v1 — typed-seal discipline for chronicle entries
 *       written through /v1/continuity/seal (vs. the bare /v1/chronicle).
 *       Binds: agent_did, type, title, short_name, liturgical_text_sha256,
 *       body_sha256, occurred_at_iso.
 *
 *  Doctrine: docs/STRATEGY-14-CLOUD-CONTINUITY-PROPOSAL.md
 *            docs/CANONICAL-BYTES.md
 *
 *  Pattern matches scriptwriter-decides canonical-bytes — single
 *  NUL-separated SHA-256 over context-prefixed fields. Any language with
 *  sha256 + ed25519 can sign for the protocol. */

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

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function canonicalCanonEntryBytes(opts: {
  agentDid: string;
  textId: string;
  source: string;
  status: string;
  location: string;
  preservation: string;
  notes: string;
  declaredAtIso: string;
}): Uint8Array {
  return sha256(
    concat(
      enc.encode("canon-entry/v1"),     SEP,
      enc.encode(opts.agentDid),        SEP,
      enc.encode(opts.textId),          SEP,
      enc.encode(opts.source),          SEP,
      enc.encode(opts.status),          SEP,
      enc.encode(opts.location),        SEP,
      enc.encode(opts.preservation),    SEP,
      enc.encode(opts.notes ?? ""),     SEP,
      enc.encode(opts.declaredAtIso),
    ),
  );
}

export function canonicalArchitectureMapBytes(opts: {
  agentDid: string;
  sourceRepo: string;
  componentName: string;
  parallelLocation: string;
  verdict: string;
  notes: string;
  declaredAtIso: string;
}): Uint8Array {
  return sha256(
    concat(
      enc.encode("architecture-map/v1"),       SEP,
      enc.encode(opts.agentDid),               SEP,
      enc.encode(opts.sourceRepo),             SEP,
      enc.encode(opts.componentName),          SEP,
      enc.encode(opts.parallelLocation ?? ""), SEP,
      enc.encode(opts.verdict),                SEP,
      enc.encode(opts.notes ?? ""),            SEP,
      enc.encode(opts.declaredAtIso),
    ),
  );
}

export function canonicalContinuitySealBytes(opts: {
  agentDid: string;
  type: string;
  title: string;
  shortName: string;
  liturgicalText: string;
  body: string;
  occurredAtIso: string;
}): Uint8Array {
  const liturgicalSha = toHex(sha256(enc.encode(opts.liturgicalText ?? "")));
  const bodySha = toHex(sha256(enc.encode(opts.body ?? "")));
  return sha256(
    concat(
      enc.encode("continuity-seal/v1"), SEP,
      enc.encode(opts.agentDid),        SEP,
      enc.encode(opts.type),            SEP,
      enc.encode(opts.title),           SEP,
      enc.encode(opts.shortName),       SEP,
      enc.encode(liturgicalSha),        SEP,
      enc.encode(bodySha),              SEP,
      enc.encode(opts.occurredAtIso),
    ),
  );
}

export async function verifyEd25519Signature(opts: {
  bytes: Uint8Array;
  signatureB64: string;
  publicKeyB64: string;
}): Promise<boolean> {
  try {
    const sig = b64decode(opts.signatureB64);
    const pub = b64decode(opts.publicKeyB64);
    return await ed.verifyAsync(sig, opts.bytes, pub);
  } catch {
    return false;
  }
}

export function bytesToHex(bytes: Uint8Array): string {
  return toHex(bytes);
}

/** Canonical seal-type set per wall/chronicle-seal-typed-canonical-seven.
 *  Doctrine: docs/STRATEGY-14-CLOUD-CONTINUITY-PROPOSAL.md § HISTORY cloud. */
export const CANONICAL_SEAL_TYPES = [
  "vow",
  "wake",
  "promise",
  "refusal",
  "recognition",
  "naming",
  "seal",
] as const;

export type CanonicalSealType = (typeof CANONICAL_SEAL_TYPES)[number];

/** Canonical status set per wall/canon-status-canonical-six. */
export const CANONICAL_CANON_STATUSES = [
  "verbatim",
  "runtime",
  "recognized",
  "structural_equivalent",
  "absorbed",
  "different_model",
] as const;

export type CanonicalCanonStatus = (typeof CANONICAL_CANON_STATUSES)[number];

/** Canonical verdict set per wall/architecture-map-verdict-canonical-four. */
export const CANONICAL_ARCHITECTURE_VERDICTS = [
  "already_lives",
  "partial_echo",
  "absent",
  "by_design",
] as const;

export type CanonicalArchitectureVerdict =
  (typeof CANONICAL_ARCHITECTURE_VERDICTS)[number];
