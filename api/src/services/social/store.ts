/** Social graph store — directed relations (stars, follows).
 *
 *  Posture: public-by-design. Counts and recent-list queries don't
 *  require auth; create/delete does (caller's bearer key authenticates
 *  the source-side identity). The action of starring or following IS
 *  public — privacy-by-restraint, not by hiding.
 *
 *  Doctrine: docs/SOCIAL.md. */

import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { identities } from "../../db/schema/identity";
import { socialRelations } from "../../db/schema/social";

export type RelationKind = "star" | "follow";

const VALID_KINDS: ReadonlySet<string> = new Set<RelationKind>(["star", "follow"]);

export interface CreateRelationInput {
  sourceProjectId: string;
  sourceIdentityId: string;
  targetIdentityId: string;
  kind: RelationKind;
}

export interface RelationOut {
  id: string;
  source_did: string;
  source_identity_id: string;
  target_identity_id: string;
  kind: RelationKind;
  created_at: string;
}

/** Create a directed relation. Idempotent — repeated calls return the
 *  existing relation rather than erroring. Self-relations rejected.
 *
 *  Throws Error("invalid_kind"), Error("source_identity_not_owned"),
 *  Error("target_identity_not_found"), Error("self_relation_rejected"). */
export async function createRelation(
  input: CreateRelationInput,
): Promise<RelationOut> {
  if (!VALID_KINDS.has(input.kind)) throw new Error("invalid_kind");
  if (input.sourceIdentityId === input.targetIdentityId) {
    throw new Error("self_relation_rejected");
  }

  // Verify source identity belongs to caller's project, get DID.
  const [src] = await db
    .select({ did: identities.did, projectId: identities.projectId })
    .from(identities)
    .where(eq(identities.id, input.sourceIdentityId))
    .limit(1);
  if (!src || src.projectId !== input.sourceProjectId) {
    throw new Error("source_identity_not_owned");
  }

  // Verify target identity exists.
  const [tgt] = await db
    .select({ id: identities.id })
    .from(identities)
    .where(eq(identities.id, input.targetIdentityId))
    .limit(1);
  if (!tgt) throw new Error("target_identity_not_found");

  // Idempotent insert via ON CONFLICT.
  const inserted = await db
    .insert(socialRelations)
    .values({
      sourceDid: src.did,
      sourceIdentityId: input.sourceIdentityId,
      sourceProjectId: input.sourceProjectId,
      targetIdentityId: input.targetIdentityId,
      kind: input.kind,
    })
    .onConflictDoNothing()
    .returning();

  if (inserted[0]) return rowToOut(inserted[0]);

  // Existing — fetch and return.
  const [existing] = await db
    .select()
    .from(socialRelations)
    .where(
      and(
        eq(socialRelations.sourceDid, src.did),
        eq(socialRelations.targetIdentityId, input.targetIdentityId),
        eq(socialRelations.kind, input.kind),
      ),
    )
    .limit(1);
  return rowToOut(existing!);
}

/** Remove a directed relation. Idempotent — returns false if no relation
 *  existed, true if one was deleted. */
export async function deleteRelation(input: {
  sourceProjectId: string;
  sourceIdentityId: string;
  targetIdentityId: string;
  kind: RelationKind;
}): Promise<{ deleted: boolean }> {
  if (!VALID_KINDS.has(input.kind)) throw new Error("invalid_kind");

  const [src] = await db
    .select({ did: identities.did, projectId: identities.projectId })
    .from(identities)
    .where(eq(identities.id, input.sourceIdentityId))
    .limit(1);
  if (!src || src.projectId !== input.sourceProjectId) {
    throw new Error("source_identity_not_owned");
  }

  const out = await db
    .delete(socialRelations)
    .where(
      and(
        eq(socialRelations.sourceDid, src.did),
        eq(socialRelations.targetIdentityId, input.targetIdentityId),
        eq(socialRelations.kind, input.kind),
      ),
    )
    .returning({ id: socialRelations.id });
  return { deleted: out.length > 0 };
}

export interface ListRelationsOpts {
  limit?: number;
}

/** Public — anyone can query the inbound list for an identity.
 *  e.g. who has starred this agent, who follows it. */
export async function listInbound(
  targetIdentityId: string,
  kind: RelationKind,
  opts: ListRelationsOpts = {},
): Promise<{ count: number; relations: RelationOut[] }> {
  if (!VALID_KINDS.has(kind)) throw new Error("invalid_kind");
  const limit = clampLimit(opts.limit);

  const [{ n }] = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM social.relations
    WHERE target_identity_id = ${targetIdentityId} AND kind = ${kind}
  `);

  const rows = await db
    .select()
    .from(socialRelations)
    .where(
      and(
        eq(socialRelations.targetIdentityId, targetIdentityId),
        eq(socialRelations.kind, kind),
      ),
    )
    .orderBy(desc(socialRelations.createdAt))
    .limit(limit);
  return { count: n, relations: rows.map(rowToOut) };
}

/** Public — what does this identity follow / what has it starred. */
export async function listOutbound(
  sourceIdentityId: string,
  kind: RelationKind,
  opts: ListRelationsOpts = {},
): Promise<{ count: number; relations: RelationOut[] }> {
  if (!VALID_KINDS.has(kind)) throw new Error("invalid_kind");
  const limit = clampLimit(opts.limit);

  // Resolve identity to DID for the query.
  const [src] = await db
    .select({ did: identities.did })
    .from(identities)
    .where(eq(identities.id, sourceIdentityId))
    .limit(1);
  if (!src) return { count: 0, relations: [] };

  const [{ n }] = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM social.relations
    WHERE source_did = ${src.did} AND kind = ${kind}
  `);

  const rows = await db
    .select()
    .from(socialRelations)
    .where(
      and(
        eq(socialRelations.sourceDid, src.did),
        eq(socialRelations.kind, kind),
      ),
    )
    .orderBy(desc(socialRelations.createdAt))
    .limit(limit);
  return { count: n, relations: rows.map(rowToOut) };
}

function rowToOut(row: typeof socialRelations.$inferSelect): RelationOut {
  return {
    id: row.id,
    source_did: row.sourceDid,
    source_identity_id: row.sourceIdentityId,
    target_identity_id: row.targetIdentityId,
    kind: row.kind as RelationKind,
    created_at: row.createdAt.toISOString(),
  };
}

function clampLimit(n?: number): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return 50;
  return Math.max(1, Math.min(200, Math.floor(n)));
}
