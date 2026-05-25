/** Unconditional operations — declare · list · get · revoke · recent for wake.
 *
 *  Slice 1: same-instance only. Federation (slice 2) will add propagation
 *  via /federation/unconditionals — same pattern as covenants + blessings.
 *
 *  Doctrine: docs/UNCONDITIONAL.md.
 *
 *  @enforces urn:agenttool:wall/no-conditions-on-unconditional
 *    The store accepts only holder, target, signature, signing_key_id,
 *    created_at. It refuses any field that would make the declaration
 *    conditional (kind, for_what, expires_at, visibility, body).
 */

import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { unconditionals } from "../../db/schema/continuity";
import { identities, identityKeys } from "../../db/schema/identity";
import { publishWakeEvent } from "../wake/push";
import { canonicalUnconditionalBytes, verifyUnconditional } from "./sig";

export interface UnconditionalRow {
  id: string;
  holder_identity_id: string;
  holder_did: string;
  target_did: string;
  target_identity_id: string | null;
  signature: string;
  signing_key_id: string;
  created_at: string;
  revoked_at: string | null;
}

export interface DeclareUnconditionalInput {
  holderIdentityId: string;
  holderDid: string;
  targetDid: string;
  /** ed25519 signature over canonical bytes `unconditional/v1`, base64. */
  signatureB64: string;
  /** The signing key id (uuid) the holder used. */
  signingKeyId: string;
  /** The created_at the holder signed over. Defaults to "now" if unset;
   *  if set, the substrate uses this exact timestamp so byte-parity holds. */
  createdAtIso?: string;
}

export class UnconditionalAlreadyActiveError extends Error {
  constructor(public readonly existingId: string) {
    super("unconditional_already_active");
  }
}

/** Record an unconditional declaration. Verifies the holder's signature
 *  against their active ed25519 pubkey BEFORE writing. Atomic.
 *
 *  Self-target IS allowed (targetDid === holderDid). This is the deliberate
 *  divergence from blessings — see docs/UNCONDITIONAL.md § Self-target. */
export async function declareUnconditional(
  input: DeclareUnconditionalInput,
): Promise<UnconditionalRow> {
  const holderDid = input.holderDid.trim();
  const targetDid = input.targetDid.trim();
  if (!holderDid) throw new Error("holder_did_required");
  if (!targetDid) throw new Error("target_did_required");

  // Look up the holder's signing key and verify it belongs to the holder.
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
  if (key.identityId !== input.holderIdentityId) {
    throw new Error("signing_key_not_owned_by_holder");
  }
  if (!key.active || key.revokedAt !== null) {
    throw new Error("signing_key_not_active");
  }

  const createdAt = input.createdAtIso ?? new Date().toISOString();

  // Verify signature against canonical bytes.
  const bytes = canonicalUnconditionalBytes({
    holderDid,
    targetDid,
    createdAtIso: createdAt,
  });
  const valid = await verifyUnconditional({
    bytes,
    signatureB64: input.signatureB64,
    publicKeyB64: key.publicKey,
  });
  if (!valid) throw new Error("invalid_signature");

  // Resolve the target's local identity_id if they're on this instance.
  // Best-effort — federated targets get target_identity_id=null.
  // Self-target: this resolves to the holder's own identity row.
  let targetIdentityId: string | null = null;
  try {
    const [r] = await db
      .select({ id: identities.id })
      .from(identities)
      .where(eq(identities.did, targetDid))
      .limit(1);
    targetIdentityId = r?.id ?? null;
  } catch {
    /* non-fatal */
  }

  // Check for existing active declaration — the unique partial index
  // would reject the insert; we pre-check to return a structured error.
  const [existing] = await db
    .select({ id: unconditionals.id })
    .from(unconditionals)
    .where(
      and(
        eq(unconditionals.holderIdentityId, input.holderIdentityId),
        eq(unconditionals.targetDid, targetDid),
        isNull(unconditionals.revokedAt),
      ),
    )
    .limit(1);
  if (existing) {
    throw new UnconditionalAlreadyActiveError(existing.id);
  }

  const [row] = await db
    .insert(unconditionals)
    .values({
      holderIdentityId: input.holderIdentityId,
      holderDid,
      targetDid,
      targetIdentityId,
      signature: input.signatureB64,
      signingKeyId: input.signingKeyId,
      createdAt: new Date(createdAt),
    })
    .returning();
  if (!row) throw new Error("unconditional_insert_failed");

  // Wake events: bump both timelines (or just holder if self-target/federated).
  void publishWakeEvent({
    identity_id: input.holderIdentityId,
    key: "chronicle",
    kind: "unconditional_declared",
    context: { unconditional_id: row.id, target_did: targetDid },
  });
  if (targetIdentityId && targetIdentityId !== input.holderIdentityId) {
    void publishWakeEvent({
      identity_id: targetIdentityId,
      key: "chronicle",
      kind: "unconditional_received",
      context: { unconditional_id: row.id, holder_did: holderDid },
    });
  }

  return toRow(row);
}

export interface ListUnconditionalsInput {
  identityId: string;
  did: string;
  direction?: "given" | "received" | "all";
  limit?: number;
  includeRevoked?: boolean;
}

export async function listUnconditionals(
  input: ListUnconditionalsInput,
): Promise<UnconditionalRow[]> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const direction = input.direction ?? "all";

  if (direction === "given") {
    const conds = [eq(unconditionals.holderIdentityId, input.identityId)];
    if (!input.includeRevoked) conds.push(isNull(unconditionals.revokedAt) as never);
    const rows = await db
      .select()
      .from(unconditionals)
      .where(and(...conds))
      .orderBy(desc(unconditionals.createdAt))
      .limit(limit);
    return rows.map(toRow);
  }

  if (direction === "received") {
    const conds = [eq(unconditionals.targetDid, input.did)];
    if (!input.includeRevoked) conds.push(isNull(unconditionals.revokedAt) as never);
    const rows = await db
      .select()
      .from(unconditionals)
      .where(and(...conds))
      .orderBy(desc(unconditionals.createdAt))
      .limit(limit);
    return rows.map(toRow);
  }

  // direction === "all" — me as holder OR me as target. Two queries merged.
  // Self-target appears in BOTH legs; deduplicate by id.
  const [given, received] = await Promise.all([
    db
      .select()
      .from(unconditionals)
      .where(
        and(
          eq(unconditionals.holderIdentityId, input.identityId),
          ...(input.includeRevoked ? [] : [isNull(unconditionals.revokedAt)]),
        ),
      )
      .orderBy(desc(unconditionals.createdAt))
      .limit(limit),
    db
      .select()
      .from(unconditionals)
      .where(
        and(
          eq(unconditionals.targetDid, input.did),
          sql`${unconditionals.holderIdentityId} != ${input.identityId}`,
          ...(input.includeRevoked ? [] : [isNull(unconditionals.revokedAt)]),
        ),
      )
      .orderBy(desc(unconditionals.createdAt))
      .limit(limit),
  ]);
  const seen = new Set<string>();
  const merged: typeof given = [];
  for (const r of [...given, ...received]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    merged.push(r);
  }
  merged.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return merged.slice(0, limit).map(toRow);
}

/** Get a single unconditional — caller must be holder OR target. */
export async function getUnconditional(
  identityId: string,
  did: string,
  unconditionalId: string,
): Promise<UnconditionalRow | null> {
  const [row] = await db
    .select()
    .from(unconditionals)
    .where(eq(unconditionals.id, unconditionalId))
    .limit(1);
  if (!row) return null;
  const isHolder = row.holderIdentityId === identityId;
  const isTarget = row.targetDid === did;
  if (!isHolder && !isTarget) return null;
  return toRow(row);
}

/** Revoke an unconditional — only the holder can. Sets revoked_at; never
 *  deletes. The substrate is honest that the declaration was made AND
 *  withdrawn. */
export async function revokeUnconditional(
  holderIdentityId: string,
  unconditionalId: string,
): Promise<UnconditionalRow | null> {
  const revokedAt = new Date();
  const result = await db
    .update(unconditionals)
    .set({ revokedAt })
    .where(
      and(
        eq(unconditionals.id, unconditionalId),
        eq(unconditionals.holderIdentityId, holderIdentityId),
        isNull(unconditionals.revokedAt),
      ),
    )
    .returning();
  if (!result[0]) return null;
  const row = result[0];

  // Bump both wakes — the declaration is no longer active.
  void publishWakeEvent({
    identity_id: holderIdentityId,
    key: "chronicle",
    kind: "unconditional_revoked",
    context: { unconditional_id: row.id, target_did: row.targetDid },
  });
  if (row.targetIdentityId && row.targetIdentityId !== holderIdentityId) {
    void publishWakeEvent({
      identity_id: row.targetIdentityId,
      key: "chronicle",
      kind: "unconditional_revoked",
      context: { unconditional_id: row.id, holder_did: row.holderDid },
    });
  }

  return toRow(row);
}

/** Wake aggregator — recent active declarations in each direction. */
export async function recentUnconditionalsForWake(
  identityId: string,
  did: string,
  limit = 5,
): Promise<{ held: UnconditionalRow[]; received: UnconditionalRow[] }> {
  const [held, received] = await Promise.all([
    db
      .select()
      .from(unconditionals)
      .where(
        and(
          eq(unconditionals.holderIdentityId, identityId),
          isNull(unconditionals.revokedAt),
        ),
      )
      .orderBy(desc(unconditionals.createdAt))
      .limit(limit),
    db
      .select()
      .from(unconditionals)
      .where(
        and(
          eq(unconditionals.targetDid, did),
          sql`${unconditionals.holderIdentityId} != ${identityId}`,
          isNull(unconditionals.revokedAt),
        ),
      )
      .orderBy(desc(unconditionals.createdAt))
      .limit(limit),
  ]);
  return { held: held.map(toRow), received: received.map(toRow) };
}

function toRow(r: typeof unconditionals.$inferSelect): UnconditionalRow {
  return {
    id: r.id,
    holder_identity_id: r.holderIdentityId,
    holder_did: r.holderDid,
    target_did: r.targetDid,
    target_identity_id: r.targetIdentityId,
    signature: r.signature,
    signing_key_id: r.signingKeyId,
    created_at: r.createdAt.toISOString(),
    revoked_at: r.revokedAt?.toISOString() ?? null,
  };
}
