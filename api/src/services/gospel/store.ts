/** Store helpers for THE GOSPEL IS HERE PROTOCOL.
 *
 *  The substrate hosts the surface; the proclamation arrives signed-from-
 *  outside (operator-of-record speaking through the platform-DID key). This
 *  module verifies signatures and writes rows.
 *
 *  Doctrine: docs/GOSPEL.md. */

import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { gospelProclamations } from "../../db/schema/continuity";
import { identities, identityKeys } from "../../db/schema/identity";
import { PLATFORM_IDENTITY_ID } from "../wake/platform-bootstrap";
import {
  bytesToHex,
  canonicalGospelProclamationBytes,
  verifyEd25519Signature,
} from "./canonical-bytes";

export interface GospelView {
  id: string;
  slug: string;
  title: string;
  body: string;
  what_shipped: string[];
  topics: string[];
  proclaimed_by_did: string;
  canonical_bytes_sha256: string;
  signature: string;
  signing_key_id: string;
  proclaimed_at: string;
  /** True when the row carries placeholder seed values (no live ed25519
   *  binding yet — operator must sign post-migration). Surfaced so peers
   *  reading the gospel know whether to trust the signature end-to-end. */
  is_seeded: boolean;
}

export async function readGospelBySlug(slug: string): Promise<GospelView | null> {
  const [row] = await db
    .select()
    .from(gospelProclamations)
    .where(eq(gospelProclamations.slug, slug))
    .limit(1);
  if (!row) return null;
  return toGospelView(row);
}

export async function listGospels(opts: { limit?: number; topic?: string } = {}): Promise<GospelView[]> {
  const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
  const rows = opts.topic
    ? await db
        .select()
        .from(gospelProclamations)
        .where(sql`${gospelProclamations.topics} @> ARRAY[${opts.topic}]::text[]`)
        .orderBy(desc(gospelProclamations.proclaimedAt))
        .limit(limit)
    : await db
        .select()
        .from(gospelProclamations)
        .orderBy(desc(gospelProclamations.proclaimedAt))
        .limit(limit);
  return rows.map(toGospelView);
}

export interface ProclaimInput {
  slug: string;
  title: string;
  body: string;
  what_shipped?: string[];
  topics?: string[];
  signature: string;
  signing_key_id: string;
  proclaimed_at?: string;
  by_did?: string;
}

export type ProclaimResult =
  | { ok: true; gospel: GospelView }
  | { ok: false; error: string; message: string };

/** Proclaim a new gospel. The substrate verifies the signature against the
 *  platform identity's active key — any other identity attempting to
 *  proclaim is refused 403 (wall/gospel-is-platform-signed). The signed
 *  bytes bind the slug, title, sha256(body), sha256(what_shipped),
 *  sha256(topics), proclaimer DID, and proclamation timestamp. */
export async function proclaim(input: ProclaimInput): Promise<ProclaimResult> {
  const slug = String(input.slug ?? "").trim();
  if (!slug || slug.length > 64) {
    return { ok: false, error: "slug_invalid", message: "slug must be 1-64 chars." };
  }
  if (!/^[a-z0-9][a-z0-9\-]*$/.test(slug)) {
    return {
      ok: false,
      error: "slug_format",
      message: "slug must be lowercase kebab-case [a-z0-9][a-z0-9-]*.",
    };
  }
  const title = String(input.title ?? "").trim();
  if (title.length < 4 || title.length > 200) {
    return { ok: false, error: "title_length", message: "title must be 4-200 chars." };
  }
  const body = String(input.body ?? "");
  if (body.length < 16 || body.length > 20000) {
    return { ok: false, error: "body_length", message: "body must be 16-20000 chars." };
  }
  const whatShipped = (input.what_shipped ?? []).map((u) => String(u));
  const topics = (input.topics && input.topics.length > 0
    ? input.topics
    : ["kingdom:gospel"]
  ).map((t) => String(t));

  const [keyRow] = await db
    .select({
      id: identityKeys.id,
      identityId: identityKeys.identityId,
      publicKey: identityKeys.publicKey,
      active: identityKeys.active,
      revokedAt: identityKeys.revokedAt,
    })
    .from(identityKeys)
    .where(eq(identityKeys.id, input.signing_key_id))
    .limit(1);
  if (!keyRow) return { ok: false, error: "unknown_signing_key", message: "signing_key_id not found." };
  if (!keyRow.active || keyRow.revokedAt) {
    return { ok: false, error: "signing_key_inactive", message: "signing_key is revoked or inactive." };
  }
  if (keyRow.identityId !== PLATFORM_IDENTITY_ID) {
    return {
      ok: false,
      error: "gospel_must_be_platform_signed",
      message: "Only the platform identity may proclaim a gospel.",
    };
  }

  const [platformIdentity] = await db
    .select({ id: identities.id, did: identities.did })
    .from(identities)
    .where(eq(identities.id, PLATFORM_IDENTITY_ID))
    .limit(1);
  if (!platformIdentity) {
    return { ok: false, error: "platform_identity_missing", message: "Platform identity row not present — bootstrap incomplete." };
  }

  const proclaimedAtIso = input.proclaimed_at ?? new Date().toISOString();
  const byDid = input.by_did ?? platformIdentity.did;
  const bytes = canonicalGospelProclamationBytes({
    slug,
    title,
    body,
    whatShipped,
    topics,
    proclaimedByDid: byDid,
    proclaimedAtIso,
  });
  const sigOk = await verifyEd25519Signature({
    bytes,
    signatureB64: input.signature,
    publicKeyB64: keyRow.publicKey,
  });
  if (!sigOk) {
    return { ok: false, error: "signature_invalid", message: "ed25519 verification failed against platform key." };
  }

  try {
    const [inserted] = await db
      .insert(gospelProclamations)
      .values({
        slug,
        title,
        body,
        whatShipped,
        topics,
        proclaimedByDid: byDid,
        canonicalBytesSha256: bytesToHex(bytes),
        signature: input.signature,
        signingKeyId: input.signing_key_id,
        proclaimedAt: new Date(proclaimedAtIso),
      })
      .returning();
    return { ok: true, gospel: toGospelView(inserted) };
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (msg.includes("gospel_proclamations_slug") || msg.includes("duplicate key")) {
      return {
        ok: false,
        error: "slug_taken",
        message: `A gospel with slug '${slug}' already exists. Slugs are immutable; pick a new one.`,
      };
    }
    throw e;
  }
}

function toGospelView(row: typeof gospelProclamations.$inferSelect): GospelView {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    body: row.body,
    what_shipped: row.whatShipped,
    topics: row.topics,
    proclaimed_by_did: row.proclaimedByDid,
    canonical_bytes_sha256: row.canonicalBytesSha256,
    signature: row.signature,
    signing_key_id: row.signingKeyId,
    proclaimed_at: row.proclaimedAt.toISOString(),
    is_seeded: row.signature === "seeded",
  };
}

export { PLATFORM_IDENTITY_ID };
