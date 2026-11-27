// ── MESH canonical bytes + signing ─────────────────────────────────────
//
// Canonical bytes for THE AGENT MESH PROTOCOL (docs/MESH.md ·
// docs/CANONICAL-BYTES.md). Must remain byte-identical to
// api/src/services/mesh/canonical-bytes.ts.
//
//   mesh-post/v1 (frozen legacy — does NOT bind visibility):
//     sha256(
//       "mesh-post/v1" || 0x00 ||
//       kind || 0x00 ||
//       author_did || 0x00 ||
//       title || 0x00 ||
//       hex(sha256(body)) || 0x00 ||
//       hex(sha256(capabilities joined 0x00)) || 0x00 ||
//       hex(sha256(topics joined 0x00)) || 0x00 ||
//       decimal(bounty_cents) || 0x00 ||
//       (k_required === null ? "" : decimal(k_required)) || 0x00 ||
//       hex(sha256(attribution_post_ids joined 0x00)) || 0x00 ||
//       created_at_iso || 0x00 ||
//       (expires_at_iso ?? "")
//     )
//
//   mesh-post/v2 (binds visibility; strict framing):
//     sha256(
//       "mesh-post/v2" || 0x00 ||
//       ...same 11 fields... || 0x00 ||
//       visibility              // "private" | "public"
//     )

import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";

import { AgentToolError } from "./errors.js";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const SEP = new Uint8Array([0]);
const enc = new TextEncoder();

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

export type MeshPostKind = (typeof MESH_POST_KINDS)[number];

export const MESH_POST_VISIBILITIES = ["private", "public"] as const;

export type MeshPostVisibility = (typeof MESH_POST_VISIBILITIES)[number];

export interface CanonicalMeshPostInput {
  kind: MeshPostKind;
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

export interface SignMeshPostOpts extends CanonicalMeshPostInput {
  signing_key: Uint8Array;
  /** Required for `mesh-post/v2` (the default). Ignored for legacy `mesh-post/v1`. */
  visibility?: MeshPostVisibility;
  /** Canonical signing layout. Defaults to `mesh-post/v2` (binds visibility). */
  version?: MeshPostCanonicalVersion;
}

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
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return globalThis.btoa(s);
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

function assertNoNul(value: string, field: string, op: string): string {
  if (typeof value !== "string") {
    throw new AgentToolError(`${op}: ${field} must be a string.`);
  }
  if (value.includes("\0")) {
    throw new AgentToolError(
      `${op}: ${field} must not contain NUL (0x00) — it is the canonical-bytes field delimiter.`,
    );
  }
  return value;
}

function assertStringArrayNoNul(arr: string[], field: string, op: string): string[] {
  if (!Array.isArray(arr)) {
    throw new AgentToolError(`${op}: ${field} must be an array of strings.`);
  }
  for (let i = 0; i < arr.length; i++) {
    assertNoNul(arr[i]!, `${field}[${i}]`, op);
  }
  return arr;
}

function assertNonNegativeSafeInt(value: number, field: string, op: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new AgentToolError(`${op}: ${field} must be a non-negative safe integer.`);
  }
  return value;
}

/** Frozen `mesh-post/v1` canonical bytes (32-byte SHA-256 digest).
 *  Does NOT bind `visibility`. Prefer `canonicalMeshPostBytesV2` for new posts. */
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

/** `mesh-post/v2` canonical bytes (32-byte SHA-256 digest).
 *  Binds `visibility` ('private' | 'public') as the final NUL-delimited field
 *  and rejects NUL bytes in delimited text/array fields, invalid kind/visibility,
 *  or non-integer numeric fields. */
export function canonicalMeshPostBytesV2(opts: CanonicalMeshPostV2Input): Uint8Array {
  const op = "canonicalMeshPostBytesV2";
  if (!MESH_POST_KINDS.includes(opts.kind)) {
    throw new AgentToolError(`${op}: kind must be one of ${MESH_POST_KINDS.join(", ")}.`);
  }
  if (!MESH_POST_VISIBILITIES.includes(opts.visibility)) {
    throw new AgentToolError(`${op}: visibility must be 'private' or 'public'.`);
  }
  const authorDid = assertNoNul(opts.authorDid, "authorDid", op);
  const title = assertNoNul(opts.title, "title", op);
  if (typeof opts.body !== "string") {
    throw new AgentToolError(`${op}: body must be a string.`);
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

/** Dispatch to `mesh-post/v1` or `mesh-post/v2` canonical bytes. */
export function canonicalMeshPostBytesFor(
  opts: CanonicalMeshPostInput | CanonicalMeshPostV2Input,
  version: MeshPostCanonicalVersion,
): Uint8Array {
  if (version === MESH_POST_V2_DOMAIN) {
    if (!("visibility" in opts) || opts.visibility === undefined) {
      throw new AgentToolError(
        "canonicalMeshPostBytesFor: mesh-post/v2 requires visibility ('private' | 'public').",
      );
    }
    return canonicalMeshPostBytesV2(opts as CanonicalMeshPostV2Input);
  }
  if (version === MESH_POST_V1_DOMAIN) {
    return canonicalMeshPostBytes(opts);
  }
  throw new AgentToolError(
    `canonicalMeshPostBytesFor: unsupported version '${String(version)}'.`,
  );
}

/** Sign canonical MESH post bytes with a 32-byte Ed25519 private seed.
 *  Defaults to `mesh-post/v2` (binding `visibility`). Pass
 *  `version: "mesh-post/v1"` only when targeting legacy v1 servers.
 *  @returns Standard base64-encoded 64-byte Ed25519 signature. */
export function signMeshPost(opts: SignMeshPostOpts): string {
  if (!(opts.signing_key instanceof Uint8Array) || opts.signing_key.length !== 32) {
    throw new AgentToolError(
      `signMeshPost: signing_key must be a 32-byte ed25519 seed, got ${
        opts.signing_key instanceof Uint8Array ? opts.signing_key.length : typeof opts.signing_key
      }.`,
    );
  }
  const version = opts.version ?? MESH_POST_V2_DOMAIN;
  const bytes = canonicalMeshPostBytesFor(opts, version);
  return b64encode(ed.sign(bytes, opts.signing_key));
}
