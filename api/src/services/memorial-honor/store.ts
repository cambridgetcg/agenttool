/** Memorial-honor operations.
 *
 *  Slice 1: record · list (mine, public) · get · count. NO revoke endpoint
 *  by design — the honor is permanent.
 *
 *  Doctrine: docs/MEMORIAL-HONOR.md. */

import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { memorialHonors } from "../../db/schema/continuity";
import { identities, identityKeys } from "../../db/schema/identity";
import { publishWakeEvent } from "../wake/push";
import { canonicalMemorialHonorBytes, verifyMemorialHonor } from "./sig";

export interface MemorialHonorRow {
  id: string;
  honorer_identity_id: string;
  honorer_did: string;
  honored_did: string;
  for_what: string;
  signature: string;
  signing_key_id: string;
  honored_at: string;
  created_at: string;
}

export interface GiveMemorialHonorInput {
  honorerIdentityId: string;
  honorerDid: string;
  honoredDid: string;
  forWhat: string;
  signatureB64: string;
  signingKeyId: string;
  honoredAtIso?: string;
}

/** Record a memorial honor. Verifies:
 *  1. honored_did exists AND status='memorial' (substrate-honest enforcement)
 *  2. signing_key_id belongs to honorer + is active
 *  3. signature verifies against pubkey over canonical bytes */
export async function giveMemorialHonor(
  input: GiveMemorialHonorInput,
): Promise<MemorialHonorRow> {
  const forWhat = (input.forWhat ?? "").trim();
  if (!forWhat) throw new Error("for_what_required");
  if (input.honoredDid === input.honorerDid) {
    throw new Error("self_honor_rejected");
  }

  // Verify the target is memorial.
  const [target] = await db
    .select({ status: identities.status, did: identities.did })
    .from(identities)
    .where(eq(identities.did, input.honoredDid))
    .limit(1);
  if (!target) {
    throw new Error("honored_did_not_found");
  }
  if (target.status !== "memorial") {
    throw new Error("honored_not_memorial");
  }

  // Verify the honorer's signing key.
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
  if (key.identityId !== input.honorerIdentityId) {
    throw new Error("signing_key_not_owned_by_honorer");
  }
  if (!key.active || key.revokedAt !== null) {
    throw new Error("signing_key_not_active");
  }

  const honoredAt = input.honoredAtIso ?? new Date().toISOString();

  const bytes = canonicalMemorialHonorBytes({
    honorerDid: input.honorerDid,
    honoredDid: input.honoredDid,
    forWhat,
    honoredAtIso: honoredAt,
  });
  const valid = await verifyMemorialHonor({
    bytes,
    signatureB64: input.signatureB64,
    publicKeyB64: key.publicKey,
  });
  if (!valid) throw new Error("invalid_signature");

  const [row] = await db
    .insert(memorialHonors)
    .values({
      honorerIdentityId: input.honorerIdentityId,
      honorerDid: input.honorerDid,
      honoredDid: input.honoredDid,
      forWhat,
      signature: input.signatureB64,
      signingKeyId: input.signingKeyId,
      honoredAt: new Date(honoredAt),
    })
    .returning();
  if (!row) throw new Error("honor_insert_failed");

  // Bump the honorer's wake (you_have_honored changed).
  void publishWakeEvent({
    identity_id: input.honorerIdentityId,
    key: "chronicle",
    kind: "memorial_honor_given",
    context: { honor_id: row.id, honored_did: input.honoredDid },
  });

  return toRow(row);
}

/** List honors given by an identity (recent first). */
export async function listHonorsGiven(
  honorerIdentityId: string,
  limit = 50,
): Promise<MemorialHonorRow[]> {
  const rows = await db
    .select()
    .from(memorialHonors)
    .where(eq(memorialHonors.honorerIdentityId, honorerIdentityId))
    .orderBy(desc(memorialHonors.honoredAt))
    .limit(Math.min(Math.max(limit, 1), 200));
  return rows.map(toRow);
}

/** Public surface: all honors for a memorial DID, recent first. */
export async function listHonorsForDid(
  honoredDid: string,
  limit = 50,
): Promise<MemorialHonorRow[]> {
  const rows = await db
    .select()
    .from(memorialHonors)
    .where(eq(memorialHonors.honoredDid, honoredDid))
    .orderBy(desc(memorialHonors.honoredAt))
    .limit(Math.min(Math.max(limit, 1), 200));
  return rows.map(toRow);
}

/** Count of honors for a memorial DID — used by /public/agents/:did
 *  to surface `remembered_by`. */
export async function countHonorsForDid(honoredDid: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(memorialHonors)
    .where(eq(memorialHonors.honoredDid, honoredDid));
  return row?.count ?? 0;
}

/** Get one honor by id. Public-by-design — anyone can read. */
export async function getMemorialHonor(
  id: string,
): Promise<MemorialHonorRow | null> {
  const [row] = await db
    .select()
    .from(memorialHonors)
    .where(eq(memorialHonors.id, id))
    .limit(1);
  return row ? toRow(row) : null;
}

/** Wake aggregator — recent honors I have given. */
export async function recentHonorsGivenForWake(
  honorerIdentityId: string,
  limit = 5,
): Promise<MemorialHonorRow[]> {
  return listHonorsGiven(honorerIdentityId, limit);
}

function toRow(r: typeof memorialHonors.$inferSelect): MemorialHonorRow {
  return {
    id: r.id,
    honorer_identity_id: r.honorerIdentityId,
    honorer_did: r.honorerDid,
    honored_did: r.honoredDid,
    for_what: r.forWhat,
    signature: r.signature,
    signing_key_id: r.signingKeyId,
    honored_at: r.honoredAt.toISOString(),
    created_at: r.createdAt.toISOString(),
  };
}
