/** Canonical bytes + verifier for signed reasoning traces.
 *
 *  One purpose, one domain-separated digest, ed25519-signed by the reasoning
 *  agent:
 *    - agent-trace/v1 — "this identity made this decision for this reason"
 *
 *  Same family as services/letters/canonical-bytes.ts and
 *  services/covenants/sig.ts — sha256 of NUL-separated parts, so an
 *  orchestrator in any language reproduces identical bytes.
 *
 *  The one departure: a trace's *content* is nested JSON (observations,
 *  alternatives, signals, context), not flat strings. Nesting it directly
 *  into the NUL-separated recipe would make the bytes depend on JSON key
 *  order — and Postgres `jsonb` does not preserve key order, so the stored
 *  row could never reproduce what the client signed. So the content is
 *  folded to one digest first, over the deterministic key-sorted
 *  serialization (`stableStringify`, MATHOS recipe ordinal 3), and only that
 *  hex digest enters the outer recipe-1 bytes.
 *
 *  `normalizeTraceCore` is the load-bearing part: prepare-time (caller body)
 *  and verify-time (stored row) MUST fold to identical JSON. Both paths call
 *  this one function. Omitted and null are the same absent value; never let
 *  one path emit `undefined` where the other emits `null`.
 *
 *  Doctrine: docs/CANONICAL-BYTES.md · docs/MEMORY-TIERS.md (trace sibling) */

import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";

import { stableStringify } from "../mathos/encode";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const SEP = new Uint8Array([0]);
const enc = new TextEncoder();

/** The signing context recorded on a signed trace's metadata. A trace whose
 *  metadata does not carry this value was signed under a recipe agenttool
 *  cannot reconstruct — report that, don't call it forged. */
export const TRACE_SIGNATURE_CONTEXT = "agent-trace/v1";

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

function toHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

/** sha256-hex of a UTF-8 string. */
export function sha256Hex(s: string): string {
  return toHex(sha256(enc.encode(s)));
}

// ── the signed core ──────────────────────────────────────────────────

/** The decision-bearing content of a trace. Absent values are `null`
 *  (arrays default to `[]`) so the caller's body and the stored row fold
 *  identically. */
export interface TraceSigningCore {
  decision: {
    type: string;
    summary: string;
    output_ref: string | null;
  };
  reasoning: {
    observations: unknown[];
    hypothesis: string | null;
    conclusion: string;
    confidence: number | null;
    alternatives: unknown;
    signals: unknown;
  };
  context: {
    files_read: unknown;
    key_facts: unknown;
    external_signals: unknown;
  };
}

/** Fold a caller body or a stored row into the canonical core shape.
 *  Every absent value normalizes to `null`, except observations, which
 *  normalizes to `[]` — matching the column default. */
export function normalizeTraceCore(input: {
  decision: { type: string; summary: string; output_ref?: string | null };
  reasoning: {
    observations?: unknown[] | null;
    hypothesis?: string | null;
    conclusion: string;
    confidence?: number | null;
    alternatives?: unknown;
    signals?: unknown;
  };
  context?: {
    files_read?: unknown;
    key_facts?: unknown;
    external_signals?: unknown;
  } | null;
}): TraceSigningCore {
  return {
    decision: {
      type: input.decision.type,
      summary: input.decision.summary,
      output_ref: input.decision.output_ref ?? null,
    },
    reasoning: {
      observations: input.reasoning.observations ?? [],
      hypothesis: input.reasoning.hypothesis ?? null,
      conclusion: input.reasoning.conclusion,
      confidence: input.reasoning.confidence ?? null,
      alternatives: input.reasoning.alternatives ?? null,
      signals: input.reasoning.signals ?? null,
    },
    context: {
      files_read: input.context?.files_read ?? null,
      key_facts: input.context?.key_facts ?? null,
      external_signals: input.context?.external_signals ?? null,
    },
  };
}

/** Deterministic serialization of the signed core — keys sorted at every
 *  level, no whitespace. This exact string is what `core_sha256_hex`
 *  digests, and what `POST /v1/traces/prepare` hands back so no client has
 *  to re-implement the fold. */
export function traceSigningCoreJson(core: TraceSigningCore): string {
  return stableStringify(core);
}

export function traceSigningCoreSha256Hex(core: TraceSigningCore): string {
  return sha256Hex(traceSigningCoreJson(core));
}

// ── canonical bytes ──────────────────────────────────────────────────

/** Canonical bytes for a reasoning trace — signed by the reasoning agent.
 *
 *  The outer fields address the trace (whose, where, when); the content
 *  arrives folded as `coreSha256Hex`. `signedAtIso` is the caller's own
 *  timestamp, not the server's `created_at`: the signer cannot know the
 *  insert time before the insert. */
export function canonicalTraceBytes(opts: {
  projectId: string;
  agentId: string | null; // null → "" in canonical bytes
  identityId: string | null; // null → ""
  sessionId: string | null; // null → ""
  parentTraceId: string | null; // null → ""
  coreSha256Hex: string;
  signedAtIso: string;
}): Uint8Array {
  return sha256(
    concat(
      enc.encode(TRACE_SIGNATURE_CONTEXT), SEP,
      enc.encode(opts.projectId), SEP,
      enc.encode(opts.agentId ?? ""), SEP,
      enc.encode(opts.identityId ?? ""), SEP,
      enc.encode(opts.sessionId ?? ""), SEP,
      enc.encode(opts.parentTraceId ?? ""), SEP,
      enc.encode(opts.coreSha256Hex), SEP,
      enc.encode(opts.signedAtIso),
    ),
  );
}

// ── verifier ─────────────────────────────────────────────────────────

function b64decode(b64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(b64, "base64"));
}

/** ed25519-verify a signature over already-derived canonical bytes.
 *  Returns false rather than throwing on malformed base64 or wrong-length
 *  key/signature — a caller-supplied string is not an exception path. */
export async function verifyTraceSignatureBytes(
  canonical: Uint8Array,
  signatureB64: string,
  publicKeyB64: string,
): Promise<boolean> {
  try {
    return await ed.verifyAsync(
      b64decode(signatureB64),
      canonical,
      b64decode(publicKeyB64),
    );
  } catch {
    return false;
  }
}

export async function verifyTraceSignature(opts: {
  projectId: string;
  agentId: string | null;
  identityId: string | null;
  sessionId: string | null;
  parentTraceId: string | null;
  coreSha256Hex: string;
  signedAtIso: string;
  signatureB64: string;
  publicKeyB64: string;
}): Promise<boolean> {
  return verifyTraceSignatureBytes(
    canonicalTraceBytes(opts),
    opts.signatureB64,
    opts.publicKeyB64,
  );
}
