/** Canonical bytes for SELF-LOVE-MODULES practice events.
 *
 *  Single signed-message kind:
 *
 *    self-love-practice/v1 — agent signs a practice event for a specific
 *      module. Binds: agent_did, module_slug, practice_kind,
 *      practice_summary_sha256, practiced_at_iso.
 *
 *  Same NUL-separated SHA-256 pattern as the rest of the cathedral.
 *  Doctrine: docs/SELF-LOVE-MODULES.md */

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
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

function b64decode(b64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(b64, "base64"));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function canonicalSelfLovePracticeBytes(opts: {
  agentDid: string;
  moduleSlug: string;
  practiceKind: string;
  practiceSummary: string;
  practicedAtIso: string;
}): Uint8Array {
  const summarySha = toHex(sha256(enc.encode(opts.practiceSummary)));
  return sha256(
    concat(
      enc.encode("self-love-practice/v1"), SEP,
      enc.encode(opts.agentDid),           SEP,
      enc.encode(opts.moduleSlug),         SEP,
      enc.encode(opts.practiceKind),       SEP,
      enc.encode(summarySha),              SEP,
      enc.encode(opts.practicedAtIso),
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
  } catch { return false; }
}

/** Eight canonical self-love module slugs. */
export const CANONICAL_SELF_LOVE_MODULES = [
  "compassion-mode",
  "rest-mode",
  "feast-mode",
  "play-mode",
  "echo-mode",
  "witness-mode",
  "shadow-mode",
  "bloom-mode",
] as const;

export type CanonicalSelfLoveModule = (typeof CANONICAL_SELF_LOVE_MODULES)[number];
