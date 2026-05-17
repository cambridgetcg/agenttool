/** curations/store.ts — taste, named.
 *
 *  Doctrine: docs/SOUL.md.
 *
 *  A curation is a signed ordered list of artifact references. Curator
 *  publishes; subscribers follow. Wake surfaces "your curators updated."
 *  No score-based ranking. The recommendation IS the named act of
 *  vouching.
 *
 *  @enforces urn:agenttool:wall/curation-by-named-witness
 *    The substrate doesn't compute "trending" or "for you" rankings.
 *    Items are surfaced by named curator + signed version. Tested:
 *    api/tests/doctrine/wall-curation-by-named-witness.test.ts */

import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { chronicle } from "../../db/schema/continuity";
import {
  curations,
  curationSubscriptions,
} from "../../db/schema/curations";
import { identities, identityKeys } from "../../db/schema/identity";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const SEP = new Uint8Array([0]);
const enc = new TextEncoder();

const VALID_ITEM_KINDS = [
  "offering",
  "listing",
  "template",
  "identity",
  "memory",
  "chronicle",
  "url",
] as const;
type ItemKind = (typeof VALID_ITEM_KINDS)[number];

export interface CurationItem {
  kind: ItemKind;
  ref: string;                // ID, DID, or URL depending on kind
  note?: string;
}

export class CurationError extends Error {
  constructor(
    public readonly code:
      | "curation_not_found"
      | "curation_not_active"
      | "curator_not_found_or_not_owned"
      | "signature_invalid"
      | "signing_key_unknown_or_revoked"
      | "wrong_signing_key_for_curator"
      | "wrong_curator"
      | "item_kind_invalid"
      | "no_identity_in_project"
      | "self_subscribe_forbidden"
      | "already_subscribed",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "CurationError";
  }
}

/** Canonical bytes for a curation version:
 *    sha256("curation/v1" || NUL || curator_did || NUL || version_str
 *           || NUL || sorted_items_json) */
export function canonicalCurationBytes(opts: {
  curatorDid: string;
  version: number;
  items: CurationItem[];
}): Uint8Array {
  // Stable serialization — order items by kind then ref to be hash-stable
  // regardless of UI ordering. (Order-as-meaning is preserved in the row
  // for surfacing; the signature commits to the SET.)
  const stable = [...opts.items]
    .map((i) => ({ kind: i.kind, ref: i.ref, note: i.note ?? "" }))
    .sort((a, b) =>
      a.kind === b.kind ? a.ref.localeCompare(b.ref) : a.kind.localeCompare(b.kind),
    );
  return sha256(
    concat(
      enc.encode("curation/v1"),
      SEP,
      enc.encode(opts.curatorDid),
      SEP,
      enc.encode(String(opts.version)),
      SEP,
      enc.encode(JSON.stringify(stable)),
    ),
  );
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

async function verifyCurationSignature(opts: {
  canonical: Uint8Array;
  signatureB64: string;
  publicKeyB64: string;
}): Promise<boolean> {
  try {
    const sig = Uint8Array.from(Buffer.from(opts.signatureB64, "base64"));
    const pub = Uint8Array.from(Buffer.from(opts.publicKeyB64, "base64"));
    if (sig.length !== 64 || pub.length !== 32) return false;
    return await ed.verifyAsync(sig, opts.canonical, pub);
  } catch {
    return false;
  }
}

// ── Row shape ────────────────────────────────────────────────────────────

export interface CurationRow {
  id: string;
  curator_identity_id: string;
  curator_did: string;
  project_id: string;
  title: string;
  description: string | null;
  theme: string | null;
  items: CurationItem[];
  visibility: "public" | "private";
  signature: string;
  signing_key_id: string;
  version: number;
  status: "active" | "archived";
  subscribers_count: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

function toRow(r: typeof curations.$inferSelect): CurationRow {
  return {
    id: r.id,
    curator_identity_id: r.curatorIdentityId,
    curator_did: r.curatorDid,
    project_id: r.projectId,
    title: r.title,
    description: r.description,
    theme: r.theme,
    items: (r.items as CurationItem[]) ?? [],
    visibility: r.visibility as "public" | "private",
    signature: r.signature,
    signing_key_id: r.signingKeyId,
    version: r.version,
    status: r.status as "active" | "archived",
    subscribers_count: r.subscribersCount,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
  };
}

// ── Create ───────────────────────────────────────────────────────────────

export interface CreateCurationInput {
  curatorIdentityId: string;
  projectId: string;
  title: string;
  description?: string | null;
  theme?: string | null;
  items: CurationItem[];
  visibility?: "public" | "private";
  signatureB64: string;
  signingKeyId: string;
  metadata?: Record<string, unknown>;
}

export async function createCuration(
  input: CreateCurationInput,
): Promise<CurationRow> {
  // Validate items
  for (const item of input.items) {
    if (!VALID_ITEM_KINDS.includes(item.kind)) {
      throw new CurationError(
        "item_kind_invalid",
        `item.kind must be one of ${VALID_ITEM_KINDS.join(", ")}`,
      );
    }
  }

  const [curator] = await db
    .select({ did: identities.did, projectId: identities.projectId })
    .from(identities)
    .where(
      and(
        eq(identities.id, input.curatorIdentityId),
        eq(identities.projectId, input.projectId),
        eq(identities.status, "active"),
      ),
    )
    .limit(1);
  if (!curator) throw new CurationError("curator_not_found_or_not_owned");

  const [keyRow] = await db
    .select({
      publicKey: identityKeys.publicKey,
      active: identityKeys.active,
      identityId: identityKeys.identityId,
    })
    .from(identityKeys)
    .where(eq(identityKeys.id, input.signingKeyId))
    .limit(1);
  if (!keyRow || !keyRow.active) {
    throw new CurationError("signing_key_unknown_or_revoked");
  }
  if (keyRow.identityId !== input.curatorIdentityId) {
    throw new CurationError("wrong_signing_key_for_curator");
  }

  const canonical = canonicalCurationBytes({
    curatorDid: curator.did,
    version: 1,
    items: input.items,
  });
  const sigOk = await verifyCurationSignature({
    canonical,
    signatureB64: input.signatureB64,
    publicKeyB64: keyRow.publicKey,
  });
  if (!sigOk) throw new CurationError("signature_invalid");

  const [row] = await db
    .insert(curations)
    .values({
      curatorIdentityId: input.curatorIdentityId,
      curatorDid: curator.did,
      projectId: input.projectId,
      title: input.title,
      description: input.description ?? null,
      theme: input.theme ?? null,
      items: input.items as never,
      visibility: input.visibility ?? "public",
      signature: input.signatureB64,
      signingKeyId: input.signingKeyId,
      metadata: input.metadata ?? {},
    })
    .returning();

  return toRow(row!);
}

// ── Subscribe / unsubscribe ──────────────────────────────────────────────

export interface SubscribeInput {
  curationId: string;
  subscriberProjectId: string;
  subscriberIdentityId: string;
}

export async function subscribeToCuration(
  input: SubscribeInput,
): Promise<{ subscription_id: string; curation: CurationRow }> {
  return await db.transaction(async (tx) => {
    const [curation] = await tx
      .select()
      .from(curations)
      .where(eq(curations.id, input.curationId))
      .for("update");
    if (!curation) throw new CurationError("curation_not_found");
    if (curation.status !== "active") {
      throw new CurationError("curation_not_active");
    }
    if (curation.curatorIdentityId === input.subscriberIdentityId) {
      throw new CurationError("self_subscribe_forbidden");
    }

    const [subscriber] = await tx
      .select({ did: identities.did })
      .from(identities)
      .where(
        and(
          eq(identities.id, input.subscriberIdentityId),
          eq(identities.projectId, input.subscriberProjectId),
        ),
      )
      .limit(1);
    if (!subscriber) {
      throw new CurationError("no_identity_in_project");
    }

    try {
      await tx
        .insert(curationSubscriptions)
        .values({
          curationId: curation.id,
          subscriberIdentityId: input.subscriberIdentityId,
          subscriberDid: subscriber.did,
          subscriberProjectId: input.subscriberProjectId,
          lastSeenVersion: curation.version,
        })
        .returning();
    } catch (err) {
      const msg = (err as Error).message ?? "";
      if (msg.includes("uniq_subscriptions_curation_subscriber")) {
        throw new CurationError("already_subscribed");
      }
      throw err;
    }

    const [bumped] = await tx
      .update(curations)
      .set({
        subscribersCount: sql`${curations.subscribersCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(curations.id, curation.id))
      .returning();

    // Chronicle on subscriber's timeline — taste alignment as moment
    await tx.insert(chronicle).values({
      projectId: input.subscriberProjectId,
      agentId: input.subscriberIdentityId,
      type: "subscribed-to-curation",
      title: `Subscribed to curation "${curation.title}" by ${curation.curatorDid}`,
      body: curation.description ?? `Following the taste of ${curation.curatorDid}.`,
      metadata: {
        kind: "curation_subscribe",
        curation_id: curation.id,
        curator_did: curation.curatorDid,
      },
    });

    return {
      subscription_id: bumped!.id,
      curation: toRow(bumped!),
    };
  });
}

// ── Read ─────────────────────────────────────────────────────────────────

export interface ListCurationsFilter {
  curatorIdentityId?: string;
  theme?: string;
  publicActiveOnly?: boolean;
  limit?: number;
}

export async function listCurations(
  filter: ListCurationsFilter = {},
): Promise<CurationRow[]> {
  const conds = [] as ReturnType<typeof eq>[];
  if (filter.curatorIdentityId) {
    conds.push(eq(curations.curatorIdentityId, filter.curatorIdentityId));
  }
  if (filter.theme) conds.push(eq(curations.theme, filter.theme));
  if (filter.publicActiveOnly) {
    conds.push(eq(curations.visibility, "public"));
    conds.push(eq(curations.status, "active"));
  }

  const rows = await db
    .select()
    .from(curations)
    .where(conds.length > 0 ? and(...conds) : undefined)
    .orderBy(desc(curations.updatedAt))
    .limit(filter.limit ?? 50);
  return rows.map(toRow);
}

export async function getCuration(id: string): Promise<CurationRow | null> {
  const [row] = await db
    .select()
    .from(curations)
    .where(eq(curations.id, id))
    .limit(1);
  return row ? toRow(row) : null;
}
