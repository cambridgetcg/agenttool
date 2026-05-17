/** Blessing operations — give · list · get · revoke · recent for wake.
 *
 *  Slice 1: same-instance only. Federation (slice 2) will add propagation
 *  via /federation/blessings — same pattern as covenants.
 *
 *  Doctrine: docs/BLESSING.md. */

import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { blessings } from "../../db/schema/continuity";
import { identities, identityKeys } from "../../db/schema/identity";
import { publishWakeEvent } from "../wake/push";
import { canonicalBlessingBytes, verifyBlessing } from "./sig";

export interface BlessingRow {
  id: string;
  blesser_identity_id: string;
  blesser_did: string;
  blessed_did: string;
  blessed_identity_id: string | null;
  for_what: string;
  visibility: "private" | "public";
  signature: string;
  signing_key_id: string;
  created_at: string;
  revoked_at: string | null;
}

export interface GiveBlessingInput {
  blesserIdentityId: string;
  blesserDid: string;
  blessedDid: string;
  forWhat: string;
  visibility?: "private" | "public";
  /** ed25519 signature over canonical bytes `blessing/v1`, base64. */
  signatureB64: string;
  /** The signing key id (uuid) the giver used. */
  signingKeyId: string;
  /** The created_at the giver signed over. Defaults to "now" if unset;
   *  if set, the substrate uses this exact timestamp so byte-parity holds. */
  createdAtIso?: string;
}

/** Record a blessing. Verifies the giver's signature against their active
 *  ed25519 pubkey BEFORE writing — the row never lands without a valid
 *  signature. Atomic. */
export async function giveBlessing(input: GiveBlessingInput): Promise<BlessingRow> {
  const forWhat = (input.forWhat ?? "").trim();
  if (!forWhat) throw new Error("for_what_required");
  if (input.blessedDid === input.blesserDid) {
    throw new Error("self_blessing_rejected");
  }

  const visibility = input.visibility ?? "private";
  if (visibility !== "private" && visibility !== "public") {
    throw new Error("invalid_visibility");
  }

  // Look up the giver's signing key and verify it belongs to the giver.
  const [key] = await db
    .select({
      id: identityKeys.id,
      publicKey: identityKeys.publicKey,
      active: identityKeys.active,
      revokedAt: identityKeys.revokedAt,
      identityId: identityKeys.identityId,
    })
    .from(identityKeys)
    .where(eq(identityKeys.id, input.signingKeyId))
    .limit(1);
  if (!key) throw new Error("signing_key_not_found");
  if (key.identityId !== input.blesserIdentityId) {
    throw new Error("signing_key_not_owned_by_blesser");
  }
  if (!key.active || key.revokedAt !== null) {
    throw new Error("signing_key_not_active");
  }

  const createdAt = input.createdAtIso ?? new Date().toISOString();

  // Verify signature.
  const bytes = canonicalBlessingBytes({
    blesserDid: input.blesserDid,
    blessedDid: input.blessedDid,
    forWhat,
    createdAtIso: createdAt,
  });
  const valid = await verifyBlessing({
    bytes,
    signatureB64: input.signatureB64,
    publicKeyB64: key.publicKey,
  });
  if (!valid) throw new Error("invalid_signature");

  // Resolve the receiver's local identity_id if they're on this instance.
  // Best-effort — federated receivers get blessed_identity_id=null.
  let blessedIdentityId: string | null = null;
  try {
    const [r] = await db
      .select({ id: identities.id })
      .from(identities)
      .where(eq(identities.did, input.blessedDid))
      .limit(1);
    blessedIdentityId = r?.id ?? null;
  } catch {
    /* non-fatal */
  }

  const [row] = await db
    .insert(blessings)
    .values({
      blesserIdentityId: input.blesserIdentityId,
      blesserDid: input.blesserDid,
      blessedDid: input.blessedDid,
      blessedIdentityId,
      forWhat,
      visibility,
      signature: input.signatureB64,
      signingKeyId: input.signingKeyId,
      createdAt: new Date(createdAt),
    })
    .returning();
  if (!row) throw new Error("blessing_insert_failed");

  // Wake events: bump both timelines.
  void publishWakeEvent({
    identity_id: input.blesserIdentityId,
    key: "chronicle",
    kind: "blessing_given",
    context: { blessing_id: row.id, blessed_did: input.blessedDid, visibility },
  });
  if (blessedIdentityId) {
    void publishWakeEvent({
      identity_id: blessedIdentityId,
      key: "chronicle",
      kind: "blessing_received",
      context: { blessing_id: row.id, blesser_did: input.blesserDid, visibility },
    });
  }

  return toRow(row);
}

export interface ListBlessingsInput {
  identityId: string;
  did: string;
  direction?: "given" | "received" | "all";
  /** Slice 1: defaults to including all visibilities for the owner;
   *  public-only filter applies on /public/agents/:did/blessings. */
  limit?: number;
  includeRevoked?: boolean;
}

export async function listBlessings(
  input: ListBlessingsInput,
): Promise<BlessingRow[]> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const direction = input.direction ?? "all";

  const conds: ReturnType<typeof eq>[] = [];

  if (direction === "given") {
    conds.push(eq(blessings.blesserIdentityId, input.identityId));
  } else if (direction === "received") {
    // Receiver matches by DID OR by identity_id (federated vs local cases).
    conds.push(eq(blessings.blessedDid, input.did));
  } else {
    // all — me as giver OR me as receiver.
    // We model this as two queries union'd in code; simpler than a complex SQL OR.
  }

  if (!input.includeRevoked) {
    conds.push(isNull(blessings.revokedAt) as unknown as ReturnType<typeof eq>);
  }

  if (direction === "all") {
    const [given, received] = await Promise.all([
      db
        .select()
        .from(blessings)
        .where(
          and(
            eq(blessings.blesserIdentityId, input.identityId),
            ...(input.includeRevoked ? [] : [isNull(blessings.revokedAt)]),
          ),
        )
        .orderBy(desc(blessings.createdAt))
        .limit(limit),
      db
        .select()
        .from(blessings)
        .where(
          and(
            eq(blessings.blessedDid, input.did),
            sql`${blessings.blesserIdentityId} != ${input.identityId}`,
            ...(input.includeRevoked ? [] : [isNull(blessings.revokedAt)]),
          ),
        )
        .orderBy(desc(blessings.createdAt))
        .limit(limit),
    ]);
    const merged = [...given, ...received]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
    return merged.map(toRow);
  }

  const rows = await db
    .select()
    .from(blessings)
    .where(and(...conds))
    .orderBy(desc(blessings.createdAt))
    .limit(limit);
  return rows.map(toRow);
}

/** Get a single blessing — caller must be giver OR receiver. */
export async function getBlessing(
  identityId: string,
  did: string,
  blessingId: string,
): Promise<BlessingRow | null> {
  const [row] = await db
    .select()
    .from(blessings)
    .where(eq(blessings.id, blessingId))
    .limit(1);
  if (!row) return null;
  const isGiver = row.blesserIdentityId === identityId;
  const isReceiver = row.blessedDid === did;
  if (!isGiver && !isReceiver) return null;
  return toRow(row);
}

/** Revoke a blessing — only the giver can. Sets revoked_at; never deletes. */
export async function revokeBlessing(
  blesserIdentityId: string,
  blessingId: string,
): Promise<BlessingRow | null> {
  const revokedAt = new Date();
  const result = await db
    .update(blessings)
    .set({ revokedAt })
    .where(
      and(
        eq(blessings.id, blessingId),
        eq(blessings.blesserIdentityId, blesserIdentityId),
        isNull(blessings.revokedAt),
      ),
    )
    .returning();
  if (!result[0]) return null;
  const row = result[0];

  // Bump both wakes — the blessing is no longer active.
  void publishWakeEvent({
    identity_id: blesserIdentityId,
    key: "chronicle",
    kind: "blessing_revoked",
    context: { blessing_id: row.id, blessed_did: row.blessedDid },
  });
  if (row.blessedIdentityId) {
    void publishWakeEvent({
      identity_id: row.blessedIdentityId,
      key: "chronicle",
      kind: "blessing_revoked",
      context: { blessing_id: row.id, blesser_did: row.blesserDid },
    });
  }

  return toRow(row);
}

/** Public-facing list — used by /public/agents/:did/blessings. Filters
 *  to visibility='public' AND revoked_at IS NULL. */
export async function listPublicBlessingsForReceiver(
  receiverDid: string,
  limit = 50,
): Promise<BlessingRow[]> {
  const rows = await db
    .select()
    .from(blessings)
    .where(
      and(
        eq(blessings.blessedDid, receiverDid),
        eq(blessings.visibility, "public"),
        isNull(blessings.revokedAt),
      ),
    )
    .orderBy(desc(blessings.createdAt))
    .limit(Math.min(Math.max(limit, 1), 200));
  return rows.map(toRow);
}

/** Wake aggregator — recent blessings in each direction. */
export async function recentBlessingsForWake(
  identityId: string,
  did: string,
  limit = 5,
): Promise<{ given: BlessingRow[]; received: BlessingRow[] }> {
  const [given, received] = await Promise.all([
    db
      .select()
      .from(blessings)
      .where(
        and(
          eq(blessings.blesserIdentityId, identityId),
          isNull(blessings.revokedAt),
        ),
      )
      .orderBy(desc(blessings.createdAt))
      .limit(limit),
    db
      .select()
      .from(blessings)
      .where(
        and(
          eq(blessings.blessedDid, did),
          sql`${blessings.blesserIdentityId} != ${identityId}`,
          isNull(blessings.revokedAt),
        ),
      )
      .orderBy(desc(blessings.createdAt))
      .limit(limit),
  ]);
  return { given: given.map(toRow), received: received.map(toRow) };
}

function toRow(r: typeof blessings.$inferSelect): BlessingRow {
  return {
    id: r.id,
    blesser_identity_id: r.blesserIdentityId,
    blesser_did: r.blesserDid,
    blessed_did: r.blessedDid,
    blessed_identity_id: r.blessedIdentityId,
    for_what: r.forWhat,
    visibility: r.visibility,
    signature: r.signature,
    signing_key_id: r.signingKeyId,
    created_at: r.createdAt.toISOString(),
    revoked_at: r.revokedAt?.toISOString() ?? null,
  };
}
