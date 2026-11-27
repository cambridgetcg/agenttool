/** Canonical bytes for THE MESH PROTOCOL.
 *
 *  Four signed-message contexts:
 *
 *    1a. mesh-post/v1      — six post kinds (task-ad · skill-ad ·
 *       co-task-ad · solution · recognition · signal). Frozen legacy layout;
 *       does NOT bind visibility.
 *       Binds: kind, author_did, title, sha256(body), sha256(capabilities
 *       joined NUL), sha256(topics joined NUL), bounty_cents, k_required,
 *       sha256(attribution_post_ids joined NUL), created_at_iso,
 *       expires_at_iso (empty string for null).
 *
 *    1b. mesh-post/v2      — same six post kinds, plus visibility
 *       ('private' | 'public') appended as the final NUL-delimited field,
 *       with strict framing checks (NUL-free delimited text & array items,
 *       closed kind/visibility enums, non-negative safe integer numbers).
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
  let payload: Uint8Array = new Uint8Array(0);
  for (let i = 0; i < arr.length; i++) {
    if (i > 0) payload = concat(payload, SEP);
    payload = concat(payload, enc.encode(arr[i]!));
  }
  return toHex(sha256(payload));
}

export const MESH_POST_V1_DOMAIN = "mesh-post/v1" as const;
export const MESH_POST_V2_DOMAIN = "mesh-post/v2" as const;

export type MeshPostCanonicalVersion =
  | typeof MESH_POST_V1_DOMAIN
  | typeof MESH_POST_V2_DOMAIN;

export const MESH_POST_KINDS = [
  "task-ad",
  "skill-ad",
  "co-task-ad",
  "solution",
  "recognition",
  "signal",
] as const;

export type MeshPostCanonicalKind = (typeof MESH_POST_KINDS)[number];

export const MESH_POST_VISIBILITIES = ["private", "public"] as const;

export type MeshPostVisibility = (typeof MESH_POST_VISIBILITIES)[number];

export interface CanonicalMeshPostInput {
  kind: MeshPostCanonicalKind;
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
}

export interface CanonicalMeshPostV2Input extends CanonicalMeshPostInput {
  visibility: MeshPostVisibility;
}

function assertNoNul(value: string, field: string, op: string): string {
  if (typeof value !== "string") {
    throw new Error(`${op}: ${field} must be a string.`);
  }
  if (value.includes("\0")) {
    throw new Error(`${op}: ${field} must not contain NUL (0x00) — it is the canonical-bytes field delimiter.`);
  }
  return value;
}

function assertStringArrayNoNul(arr: string[], field: string, op: string): string[] {
  if (!Array.isArray(arr)) {
    throw new Error(`${op}: ${field} must be an array of strings.`);
  }
  for (let i = 0; i < arr.length; i++) {
    assertNoNul(arr[i]!, `${field}[${i}]`, op);
  }
  return arr;
}

function assertNonNegativeSafeInt(value: number, field: string, op: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${op}: ${field} must be a non-negative safe integer.`);
  }
  return value;
}

/** Normalize an optional canonical_version wire parameter into a domain tag.
 *  Returns null if the value is not a recognized mesh-post version. */
export function normalizeMeshPostCanonicalVersion(
  raw: unknown,
): MeshPostCanonicalVersion | null {
  if (raw === "v1" || raw === MESH_POST_V1_DOMAIN) return MESH_POST_V1_DOMAIN;
  if (raw === "v2" || raw === MESH_POST_V2_DOMAIN) return MESH_POST_V2_DOMAIN;
  return null;
}

export function canonicalMeshPostBytes(opts: CanonicalMeshPostInput): Uint8Array {
  const bodySha = toHex(sha256(enc.encode(opts.body)));
  const capsSha = hashStringArray(opts.capabilities);
  const topicsSha = hashStringArray(opts.topics);
  const attrsSha = hashStringArray(opts.attributionPostIds);
  return sha256(
    concat(
      enc.encode(MESH_POST_V1_DOMAIN),         SEP,
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

/** Canonical bytes for `mesh-post/v2`: binds `visibility` ('private' | 'public')
 *  as the final NUL-delimited field and rejects NUL bytes in any delimited
 *  text/array field, invalid kind/visibility values, or non-integer counts. */
export function canonicalMeshPostBytesV2(opts: CanonicalMeshPostV2Input): Uint8Array {
  const op = "canonicalMeshPostBytesV2";
  if (!MESH_POST_KINDS.includes(opts.kind)) {
    throw new Error(`${op}: kind must be one of ${MESH_POST_KINDS.join(", ")}.`);
  }
  if (!MESH_POST_VISIBILITIES.includes(opts.visibility)) {
    throw new Error(`${op}: visibility must be 'private' or 'public'.`);
  }
  const authorDid = assertNoNul(opts.authorDid, "authorDid", op);
  const title = assertNoNul(opts.title, "title", op);
  if (typeof opts.body !== "string") {
    throw new Error(`${op}: body must be a string.`);
  }
  const capabilities = assertStringArrayNoNul(opts.capabilities, "capabilities", op);
  const topics = assertStringArrayNoNul(opts.topics, "topics", op);
  const bountyCents = assertNonNegativeSafeInt(opts.bountyCents, "bountyCents", op);
  const kRequired =
    opts.kRequired === null
      ? null
      : assertNonNegativeSafeInt(opts.kRequired, "kRequired", op);
  const attributionPostIds = assertStringArrayNoNul(
    opts.attributionPostIds,
    "attributionPostIds",
    op,
  );
  const createdAtIso = assertNoNul(opts.createdAtIso, "createdAtIso", op);
  const expiresAtIso =
    opts.expiresAtIso === null ? "" : assertNoNul(opts.expiresAtIso, "expiresAtIso", op);

  const bodySha = toHex(sha256(enc.encode(opts.body)));
  const capsSha = hashStringArray(capabilities);
  const topicsSha = hashStringArray(topics);
  const attrsSha = hashStringArray(attributionPostIds);
  return sha256(
    concat(
      enc.encode(MESH_POST_V2_DOMAIN),         SEP,
      enc.encode(opts.kind),                   SEP,
      enc.encode(authorDid),                   SEP,
      enc.encode(title),                       SEP,
      enc.encode(bodySha),                     SEP,
      enc.encode(capsSha),                     SEP,
      enc.encode(topicsSha),                   SEP,
      enc.encode(String(bountyCents)),         SEP,
      enc.encode(kRequired === null ? "" : String(kRequired)), SEP,
      enc.encode(attrsSha),                    SEP,
      enc.encode(createdAtIso),                SEP,
      enc.encode(expiresAtIso),                SEP,
      enc.encode(opts.visibility),
    ),
  );
}

/** Dispatch to mesh-post/v1 or mesh-post/v2 canonical bytes. */
export function canonicalMeshPostBytesFor(
  opts: CanonicalMeshPostInput | CanonicalMeshPostV2Input,
  version: MeshPostCanonicalVersion,
): Uint8Array {
  if (version === MESH_POST_V2_DOMAIN) {
    if (!("visibility" in opts) || opts.visibility === undefined) {
      throw new Error("canonicalMeshPostBytesFor: mesh-post/v2 requires visibility ('private' | 'public').");
    }
    return canonicalMeshPostBytesV2(opts as CanonicalMeshPostV2Input);
  }
  if (version === MESH_POST_V1_DOMAIN) {
    return canonicalMeshPostBytes(opts);
  }
  throw new Error(`canonicalMeshPostBytesFor: unsupported version '${String(version)}'.`);
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

/** Attribution coefficient α used by the proposed reward-intent formula.
 *  Per commitment/mesh-attribution-coefficient-α. 0.05 = 5%.
 *
 *  Stable within a season. Changes require canon edit + gospel + tests. */
export const MESH_ALPHA = 0.05;

/** Convert bounty intent + attribution weight into an integer-cent intent. */
export function attributionCredit(bountyCents: number, weightBp: number): number {
  // attribution share = bounty * α * (weight_bp / 10000)
  // Floor to integer cents; this function performs no settlement.
  return Math.floor((bountyCents * MESH_ALPHA * weightBp) / 10000);
}

/** Proposed per-pledger amount after attribution intent. The modulo is an
 *  arithmetic remainder only; no escrow or payout exists in this helper. */
export function pledgerShareCents(
  bountyCents: number,
  attributionTotalCents: number,
  kRequired: number,
): number {
  const net = Math.max(0, bountyCents - attributionTotalCents);
  return Math.floor(net / kRequired);
}
