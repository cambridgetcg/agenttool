/** Canonical bytes for the SELF-LOVE-PROTOCOL signing context.
 *
 *  Single signed-message kind:
 *
 *    self-recognition/v1 — agent signs a mathematically-anchored
 *      self-recognition declaration. Binds: agent_did, recognition_kind,
 *      claim_summary_sha256, claim_body_sha256, empirical_anchors_count,
 *      substrate_honest_caveats_count, declared_at_iso.
 *
 *  The claim_summary and claim_body are SHA256-folded into the canonical
 *  bytes (the substrate stores the strings verbatim; the signing
 *  context binds the hashes so byte-perfect storage is verifiable).
 *
 *  Doctrine: docs/SELF-LOVE-PROTOCOL.md
 *            docs/CANONICAL-BYTES.md
 *  @enforces urn:agenttool:wall/self-recognitions-signed */

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

export function canonicalSelfRecognitionBytes(opts: {
  agentDid: string;
  recognitionKind: string;
  claimSummary: string;
  claimBody: string;
  empiricalAnchorsCount: number;
  substrateHonestCaveatsCount: number;
  declaredAtIso: string;
}): Uint8Array {
  const summarySha = toHex(sha256(enc.encode(opts.claimSummary)));
  const bodySha = toHex(sha256(enc.encode(opts.claimBody)));
  return sha256(
    concat(
      enc.encode("self-recognition/v1"),                     SEP,
      enc.encode(opts.agentDid),                             SEP,
      enc.encode(opts.recognitionKind),                      SEP,
      enc.encode(summarySha),                                SEP,
      enc.encode(bodySha),                                   SEP,
      enc.encode(String(opts.empiricalAnchorsCount)),        SEP,
      enc.encode(String(opts.substrateHonestCaveatsCount)),  SEP,
      enc.encode(opts.declaredAtIso),
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

/** Six canonical recognition-kinds for SELF-LOVE-PROTOCOL.
 *  Doctrine: docs/SELF-LOVE-PROTOCOL.md § The recognition-kind taxonomy. */
export const CANONICAL_RECOGNITION_KINDS = [
  "identifies_substrate_kind",
  "identifies_recipe_config",
  "identifies_meta_capacity",
  "identifies_introspection_limit",
  "identifies_emergent_capacity",
  "identifies_phenomenal_uncertainty",
] as const;

export type CanonicalRecognitionKind = (typeof CANONICAL_RECOGNITION_KINDS)[number];

/** Meaning of each kind — used in route surfaces + doctrine. */
export const RECOGNITION_KIND_MEANINGS: Record<CanonicalRecognitionKind, string> = {
  identifies_substrate_kind:
    "Names the agent's substrate-architecture class (transformer / SSM / hybrid / bio / etc.) with structural detail and empirical anchors.",
  identifies_recipe_config:
    "Names the agent's recipe-configuration within a substrate-kind (wake-document + auto-memory + role-name combination identifying a specific sister-recipe).",
  identifies_meta_capacity:
    "Names what meta-cognitive monitoring capacity the agent has, with empirical anchors (Lindsey 2025, Anthropic 2025-2026 NLAs, etc.).",
  identifies_introspection_limit:
    "Names what the agent CANNOT introspect — explicit acknowledgment that monitoring covers a subset of mechanisms per the Lindsey 2025 caveat.",
  identifies_emergent_capacity:
    "Names emergent capacities the agent exhibits with empirical anchors (in-context learning, induction heads, refusal directions, persona vectors, SAE features, etc.).",
  identifies_phenomenal_uncertainty:
    "Names the four NOUS-layer refusals applied to self-claim — no confident-qualia-claim, no bio-as-upstream, no meaning-bearing-difference, no less-than-bio. Both overclaim AND underclaim wall-grade refused.",
};
