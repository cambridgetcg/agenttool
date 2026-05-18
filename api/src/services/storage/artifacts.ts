/** Supabase Storage helper for content-addressable artifacts.
 *
 *  Stores artifact bodies by their canonical-bytes-sha256 hash. Anyone
 *  with the hash can resolve to the same bytes — defines the "content-
 *  addressable" property the integration plan names.
 *
 *  Bucket: agenttool-artifacts (public-read; slice 2 adds private ACL).
 *  Path:   <kind>/<sha256-hex>.{ext}
 *  Kinds:  scriptwriter-decides-submissions, gi-collaboration-artifacts,
 *          room-contributions-large
 *
 *  Doctrine: docs/STORAGE-ARTIFACTS.md.
 *
 *  @enforces urn:agenttool:commitment/heavy-bytes-leave-postgres-keep-hashes */

import { createHash } from "node:crypto";

const BUCKET = "agenttool-artifacts";

export interface ArtifactsConfig {
  /** https://<ref>.supabase.co */
  supabaseRestUrl: string;
  /** sb_secret_… (service role) */
  serviceKey: string;
}

export type ArtifactKind =
  | "scriptwriter-decides-submissions"
  | "gi-collaboration-artifacts"
  | "room-contributions-large";

export interface UploadResult {
  bucket: string;
  path: string;
  url: string;
  sha256_hex: string;
  size_bytes: number;
}

/** Compute the hex SHA-256 of bytes — the content-addressable key. */
export function artifactHash(bytes: Uint8Array | string): string {
  const buf = typeof bytes === "string" ? Buffer.from(bytes, "utf8") : Buffer.from(bytes);
  return createHash("sha256").update(buf).digest("hex");
}

/** Build the canonical bucket path for a given kind + hash. */
export function artifactPath(kind: ArtifactKind, hash: string, ext = "txt"): string {
  return `${kind}/${hash}.${ext}`;
}

/** Build the public URL for an artifact path. Only meaningful when
 *  body_storage_acl='public'; private ACLs need signed URLs (slice 2). */
export function publicUrl(cfg: ArtifactsConfig, path: string): string {
  return `${cfg.supabaseRestUrl.replace(/\/$/, "")}/storage/v1/object/public/${BUCKET}/${path}`;
}

/** Upload bytes to the artifacts bucket by content hash. Idempotent —
 *  re-uploading the same hash overwrites with identical bytes. */
export async function uploadArtifact(
  cfg: ArtifactsConfig,
  kind: ArtifactKind,
  bytes: Uint8Array | string,
  opts: { ext?: string; contentType?: string; upsert?: boolean } = {},
): Promise<UploadResult> {
  const buf = typeof bytes === "string" ? Buffer.from(bytes, "utf8") : Buffer.from(bytes);
  const sha256_hex = artifactHash(buf);
  const path = artifactPath(kind, sha256_hex, opts.ext ?? "txt");
  const url = `${cfg.supabaseRestUrl.replace(/\/$/, "")}/storage/v1/object/${BUCKET}/${path}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${cfg.serviceKey}`,
      apikey: cfg.serviceKey,
      "content-type": opts.contentType ?? "application/octet-stream",
      "x-upsert": opts.upsert === false ? "false" : "true",
      "cache-control": "public, max-age=31536000, immutable",
    },
    body: new Uint8Array(buf),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // 409 conflict means object exists + upsert=false — that's fine for
    // content-addressable uploads where same hash = same bytes.
    if (res.status === 409) {
      return {
        bucket: BUCKET,
        path,
        url: publicUrl(cfg, path),
        sha256_hex,
        size_bytes: buf.byteLength,
      };
    }
    throw new Error(`storage upload failed ${res.status}: ${body}`);
  }

  return {
    bucket: BUCKET,
    path,
    url: publicUrl(cfg, path),
    sha256_hex,
    size_bytes: buf.byteLength,
  };
}

/** Download artifact bytes by path. Public bucket → unauthenticated GET. */
export async function downloadArtifact(
  cfg: ArtifactsConfig,
  path: string,
): Promise<Uint8Array> {
  const url = publicUrl(cfg, path);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`storage download failed ${res.status} for ${path}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

/** Resolve the canonical bucket path for an existing canonical_bytes_sha256
 *  hash + kind. The substrate stores; the client constructs URLs from
 *  hashes deterministically. */
export function resolvePath(kind: ArtifactKind, sha256_hex: string, ext = "txt"): string {
  if (!/^[0-9a-f]{64}$/i.test(sha256_hex)) {
    throw new Error("sha256_hex must be a 64-char hex digest");
  }
  return artifactPath(kind, sha256_hex, ext);
}

export const ARTIFACTS_BUCKET = BUCKET;
