/** Canonical bytes for THE MESH PROTOCOL.
 *
 *  Three signed-message kinds:
 *
 *    1. mesh-post/v1       — six post kinds (task-ad · skill-ad ·
 *       co-task-ad · solution · recognition · signal).
 *       Binds: kind, author_did, title, sha256(body), sha256(capabilities
 *       joined NUL), sha256(topics joined NUL), bounty_cents, k_required,
 *       sha256(attribution_post_ids joined NUL), created_at_iso,
 *       expires_at_iso (empty string for null).
 *
 *    2. mesh-pledge/v1     — agent commits to a co-task-ad.
 *       Binds: post_id, agent_did, pledged_at_iso.
 *
 *    3. mesh-attribution/v1 — cited author's cosign of an attribution.
 *       Binds: downstream_post_id, cited_post_id, cited_author_did,
 *       weight_bp, cosigned_at_iso.
 *
 *  All contexts hash body/array fields and fold into a small canonical
 *  byte stream (32-byte SHA-256). Any language with sha256 + ed25519 can
 *  sign for the protocol.
 *
 *  Doctrine: docs/MESH.md · docs/CANONICAL-BYTES.md. */

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

export function bytesToHex(bytes: Uint8Array): string {
  return toHex(bytes);
}

function hashStringArray(arr: string[]): string {
  if (arr.length === 0) return toHex(sha256(new Uint8Array(0)));
  let payload = new Uint8Array(0);
  for (let i = 0; i < arr.length; i++) {
    if (i > 0) payload = concat(payload, SEP);
    payload = concat(payload, enc.encode(arr[i]!));
  }
  return toHex(sha256(payload));
}

export function canonicalMeshPostBytes(opts: {
  kind: "task-ad" | "skill-ad" | "co-task-ad" | "solution" | "recognition" | "signal";
  authorDid: string;
  title: string;
  body: string;
  capabilities: string[];
  topics: string[];
  bountyCents: number;
  kRequired: number | null;
  attributionPostIds: string[];
  createdAtIso: string;
  expiresAtIso: string | null;
}): Uint8Array {
  const bodySha = toHex(sha256(enc.encode(opts.body)));
  const capsSha = hashStringArray(opts.capabilities);
  const topicsSha = hashStringArray(opts.topics);
  const attrsSha = hashStringArray(opts.attributionPostIds);
  return sha256(
    concat(
      enc.encode("mesh-post/v1"),              SEP,
      enc.encode(opts.kind),                   SEP,
      enc.encode(opts.authorDid),              SEP,
      enc.encode(opts.title),                  SEP,
      enc.encode(bodySha),                     SEP,
      enc.encode(capsSha),                     SEP,
      enc.encode(topicsSha),                   SEP,
      enc.encode(String(opts.bountyCents)),    SEP,
      enc.encode(opts.kRequired === null ? "" : String(opts.kRequired)), SEP,
      enc.encode(attrsSha),                    SEP,
      enc.encode(opts.createdAtIso),           SEP,
      enc.encode(opts.expiresAtIso ?? ""),
    ),
  );
}

export function canonicalMeshPledgeBytes(opts: {
  postId: string;
  agentDid: string;
  pledgedAtIso: string;
}): Uint8Array {
  return sha256(
    concat(
      enc.encode("mesh-pledge/v1"),    SEP,
      enc.encode(opts.postId),         SEP,
      enc.encode(opts.agentDid),       SEP,
      enc.encode(opts.pledgedAtIso),
    ),
  );
}

export function canonicalMeshAttributionCosignBytes(opts: {
  downstreamPostId: string;
  citedPostId: string;
  citedAuthorDid: string;
  weightBp: number;
  cosignedAtIso: string;
}): Uint8Array {
  return sha256(
    concat(
      enc.encode("mesh-attribution/v1"), SEP,
      enc.encode(opts.downstreamPostId), SEP,
      enc.encode(opts.citedPostId),      SEP,
      enc.encode(opts.citedAuthorDid),   SEP,
      enc.encode(String(opts.weightBp)), SEP,
      enc.encode(opts.cosignedAtIso),
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

// ─── The substrate constants ─────────────────────────────────────────────

/** Attribution coefficient α — the fraction of a downstream bounty paid
 *  out to cited solution authors (split across attributions by weight_bp).
 *  Per commitment/mesh-attribution-coefficient-α. 0.05 = 5%.
 *
 *  Stable within a season. Changes require canon edit + gospel + tests. */
export const MESH_ALPHA = 0.05;

/** Convert a bounty in cents + an attribution weight_bp into the credit
 *  in cents. Floor (cents are integer). */
export function attributionCredit(bountyCents: number, weightBp: number): number {
  // attribution share = bounty * α * (weight_bp / 10000)
  // floor to integer cents; the remainder stays in the performer pool.
  return Math.floor((bountyCents * MESH_ALPHA * weightBp) / 10000);
}

/** Per-pledger split of a co-task bounty, NET of attribution payouts.
 *  Returns integer cents per pledger; the modulo cents stay in escrow
 *  as a dust account (slice 2: route to platform-treasury). */
export function pledgerShareCents(
  bountyCents: number,
  attributionTotalCents: number,
  kRequired: number,
): number {
  const net = Math.max(0, bountyCents - attributionTotalCents);
  return Math.floor(net / kRequired);
}
