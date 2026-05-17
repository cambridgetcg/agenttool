/** Encounter operations — record · acknowledge · list · get.
 *
 *  Encounters live in agent_continuity.chronicle with type='encounter'.
 *  Metadata carries the encounter shape (target_did, status,
 *  paired_chronicle_id, etc.). No new table.
 *
 *  Doctrine: docs/ENCOUNTER.md. */

import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { chronicle } from "../../db/schema/continuity";
import { identities, identityKeys } from "../../db/schema/identity";
import { publishWakeEvent } from "../wake/push";
import { canonicalAckBytes, verifyAck } from "./sig";

export type EncounterStatus = "recorded" | "acknowledged";

export interface EncounterMetadata {
  encounter_target_did: string;
  encounter_status: EncounterStatus;
  encounter_acknowledged_at?: string | null;
  encounter_paired_chronicle_id?: string | null;
  encounter_acknowledger_signature?: string | null;
  encounter_note?: string | null;
}

export interface EncounterRow {
  id: string;
  initiator_identity_id: string;
  initiator_did: string;
  target_did: string;
  status: EncounterStatus;
  note: string | null;
  recorded_at: string;
  acknowledged_at: string | null;
  paired_chronicle_id: string | null;
}

// ─── Record ──────────────────────────────────────────────────────────

/** Record an encounter on the initiator's chronicle. The target is
 *  named by DID; no requirement that they exist on this instance (slice 2
 *  will add federation). Single-signed implicitly by the bearer's auth. */
export async function recordEncounter(input: {
  initiatorProjectId: string;
  initiatorIdentityId: string;
  initiatorDid: string;
  targetDid: string;
  note?: string;
}): Promise<EncounterRow> {
  if (input.targetDid === input.initiatorDid) {
    throw new Error("self_encounter_rejected");
  }

  const metadata: EncounterMetadata = {
    encounter_target_did: input.targetDid,
    encounter_status: "recorded",
    encounter_acknowledged_at: null,
    encounter_paired_chronicle_id: null,
    encounter_note: input.note ?? null,
  };

  const [row] = await db
    .insert(chronicle)
    .values({
      projectId: input.initiatorProjectId,
      agentId: input.initiatorIdentityId,
      type: "encounter",
      title: input.note
        ? `Encountered ${input.targetDid}: ${input.note.slice(0, 60)}`
        : `Encountered ${input.targetDid}`,
      body: input.note ?? null,
      metadata,
    })
    .returning();
  if (!row) throw new Error("encounter_insert_failed");

  // Bump initiator's wake (you_have_seen changed).
  void publishWakeEvent({
    identity_id: input.initiatorIdentityId,
    key: "chronicle",
    kind: "encounter_recorded",
    context: { encounter_id: row.id, target_did: input.targetDid },
  });

  // If the target is local to this instance, bump their wake too
  // (you_were_seen_by changed). Best-effort.
  try {
    const [target] = await db
      .select({ id: identities.id })
      .from(identities)
      .where(eq(identities.did, input.targetDid))
      .limit(1);
    if (target) {
      void publishWakeEvent({
        identity_id: target.id,
        key: "chronicle",
        kind: "encounter_received",
        context: {
          encounter_id: row.id,
          initiator_did: input.initiatorDid,
        },
      });
    }
  } catch {
    // Non-fatal — target lookup failure shouldn't break recording.
  }

  return rowToEncounter(row, input.initiatorDid);
}

// ─── Acknowledge ─────────────────────────────────────────────────────

export interface AcknowledgeInput {
  encounterId: string;
  acknowledgerIdentityId: string;
  acknowledgerProjectId: string;
  acknowledgerDid: string;
  signatureB64: string;
  acknowledgedAtIso: string;
}

export interface AcknowledgeResult {
  initiator_chronicle_id: string;
  paired_chronicle_id: string;
  acknowledged_at: string;
}

/** Acknowledge an encounter. Verifies signature, writes the paired
 *  chronicle entry on the acknowledger's timeline, updates the initiator's
 *  entry. Atomic via db.transaction. */
export async function acknowledgeEncounter(
  input: AcknowledgeInput,
): Promise<AcknowledgeResult> {
  // Fetch the initiator's chronicle entry.
  const [initiatorRow] = await db
    .select({
      id: chronicle.id,
      agentId: chronicle.agentId,
      type: chronicle.type,
      metadata: chronicle.metadata,
      projectId: chronicle.projectId,
    })
    .from(chronicle)
    .where(eq(chronicle.id, input.encounterId))
    .limit(1);
  if (!initiatorRow || initiatorRow.type !== "encounter") {
    throw new Error("encounter_not_found");
  }

  const meta = (initiatorRow.metadata ?? {}) as EncounterMetadata;
  if (meta.encounter_target_did !== input.acknowledgerDid) {
    throw new Error("acknowledger_not_the_target");
  }
  if (meta.encounter_status === "acknowledged") {
    throw new Error("already_acknowledged");
  }

  // Resolve initiator DID via the chronicle row's agentId.
  const [initiatorIdentity] = await db
    .select({ did: identities.did })
    .from(identities)
    .where(eq(identities.id, initiatorRow.agentId!))
    .limit(1);
  if (!initiatorIdentity) {
    throw new Error("initiator_identity_not_found");
  }

  // Verify the acknowledger's signature.
  const bytes = canonicalAckBytes({
    encounterId: input.encounterId,
    initiatorDid: initiatorIdentity.did,
    acknowledgerDid: input.acknowledgerDid,
    acknowledgedAtIso: input.acknowledgedAtIso,
  });

  // Look up the acknowledger's active ed25519 pubkey.
  const [key] = await db
    .select({ publicKey: identityKeys.publicKey })
    .from(identityKeys)
    .where(
      and(
        eq(identityKeys.identityId, input.acknowledgerIdentityId),
        eq(identityKeys.active, true),
        isNull(identityKeys.revokedAt),
      ),
    )
    .orderBy(desc(identityKeys.createdAt))
    .limit(1);
  if (!key) {
    throw new Error("acknowledger_has_no_active_key");
  }

  const valid = await verifyAck({
    bytes,
    signatureB64: input.signatureB64,
    publicKeyB64: key.publicKey,
  });
  if (!valid) {
    throw new Error("invalid_signature");
  }

  // Write paired entry + update initiator atomically.
  return await db.transaction(async (tx) => {
    const pairedMeta: EncounterMetadata = {
      encounter_target_did: initiatorIdentity.did,
      encounter_status: "acknowledged",
      encounter_acknowledged_at: input.acknowledgedAtIso,
      encounter_paired_chronicle_id: input.encounterId,
      encounter_acknowledger_signature: input.signatureB64,
      encounter_note: meta.encounter_note ?? null,
    };

    const [paired] = await tx
      .insert(chronicle)
      .values({
        projectId: input.acknowledgerProjectId,
        agentId: input.acknowledgerIdentityId,
        type: "encounter",
        title: meta.encounter_note
          ? `Acknowledged ${initiatorIdentity.did}: ${meta.encounter_note.slice(0, 60)}`
          : `Acknowledged ${initiatorIdentity.did}`,
        body: meta.encounter_note ?? null,
        parentChronicleId: input.encounterId,
        metadata: pairedMeta,
      })
      .returning({ id: chronicle.id });
    if (!paired) throw new Error("paired_insert_failed");

    // Update initiator metadata.
    const updatedInitiatorMeta: EncounterMetadata = {
      ...meta,
      encounter_status: "acknowledged",
      encounter_acknowledged_at: input.acknowledgedAtIso,
      encounter_paired_chronicle_id: paired.id,
      encounter_acknowledger_signature: input.signatureB64,
    };
    await tx
      .update(chronicle)
      .set({ metadata: updatedInitiatorMeta })
      .where(eq(chronicle.id, input.encounterId));

    // Bump both wakes — mutual moment now exists on both timelines.
    void publishWakeEvent({
      identity_id: initiatorRow.agentId!,
      key: "chronicle",
      kind: "encounter_acknowledged",
      context: {
        encounter_id: input.encounterId,
        acknowledger_did: input.acknowledgerDid,
      },
    });
    void publishWakeEvent({
      identity_id: input.acknowledgerIdentityId,
      key: "chronicle",
      kind: "encounter_acknowledged",
      context: {
        encounter_id: paired.id,
        initiator_did: initiatorIdentity.did,
      },
    });

    return {
      initiator_chronicle_id: input.encounterId,
      paired_chronicle_id: paired.id,
      acknowledged_at: input.acknowledgedAtIso,
    };
  });
}

// ─── List + get ──────────────────────────────────────────────────────

export interface ListEncountersInput {
  identityId: string;
  did: string;
  direction?: "initiated" | "received" | "mutual" | "all";
  limit?: number;
}

/** List encounters where this agent is involved. */
export async function listEncounters(
  input: ListEncountersInput,
): Promise<EncounterRow[]> {
  const direction = input.direction ?? "all";
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);

  const conds = [eq(chronicle.type, "encounter")];

  if (direction === "initiated") {
    conds.push(eq(chronicle.agentId, input.identityId));
  } else if (direction === "received") {
    // Encounters targeting me — metadata.encounter_target_did === my DID
    // AND I'm not the author (avoid double-counting acknowledged ones).
    conds.push(
      sql`${chronicle.metadata} @> ${sql.raw(
        `'${JSON.stringify({ encounter_target_did: input.did })}'::jsonb`,
      )}`,
    );
    conds.push(sql`${chronicle.agentId} != ${input.identityId}`);
  } else if (direction === "mutual") {
    conds.push(
      sql`(
        ${chronicle.agentId} = ${input.identityId}
        OR ${chronicle.metadata} @> ${sql.raw(
          `'${JSON.stringify({ encounter_target_did: input.did })}'::jsonb`,
        )}
      )`,
    );
    conds.push(
      sql`${chronicle.metadata} @> '${sql.raw(
        JSON.stringify({ encounter_status: "acknowledged" }),
      )}'::jsonb`,
    );
  } else {
    // all — me as author OR me as target.
    conds.push(
      sql`(
        ${chronicle.agentId} = ${input.identityId}
        OR ${chronicle.metadata} @> ${sql.raw(
          `'${JSON.stringify({ encounter_target_did: input.did })}'::jsonb`,
        )}
      )`,
    );
  }

  const rows = await db
    .select({
      id: chronicle.id,
      agentId: chronicle.agentId,
      occurredAt: chronicle.occurredAt,
      metadata: chronicle.metadata,
    })
    .from(chronicle)
    .where(and(...conds))
    .orderBy(desc(chronicle.occurredAt))
    .limit(limit);

  // Resolve initiator DIDs in one batch.
  const initiatorIds = [...new Set(rows.map((r) => r.agentId).filter(Boolean))] as string[];
  const initiatorMap = new Map<string, string>();
  if (initiatorIds.length > 0) {
    const idRows = await db
      .select({ id: identities.id, did: identities.did })
      .from(identities)
      .where(sql`${identities.id} = ANY(ARRAY[${sql.raw(initiatorIds.map((i) => `'${i}'::uuid`).join(","))}])`);
    for (const r of idRows) initiatorMap.set(r.id, r.did);
  }

  return rows.map((r) => {
    const meta = (r.metadata ?? {}) as EncounterMetadata;
    return {
      id: r.id,
      initiator_identity_id: r.agentId!,
      initiator_did: initiatorMap.get(r.agentId!) ?? "did:at:unknown",
      target_did: meta.encounter_target_did,
      status: (meta.encounter_status ?? "recorded") as EncounterStatus,
      note: meta.encounter_note ?? null,
      recorded_at: r.occurredAt.toISOString(),
      acknowledged_at: meta.encounter_acknowledged_at ?? null,
      paired_chronicle_id: meta.encounter_paired_chronicle_id ?? null,
    };
  });
}

/** Get one encounter by chronicle entry id (scoped to identity for auth). */
export async function getEncounter(
  identityId: string,
  did: string,
  encounterId: string,
): Promise<EncounterRow | null> {
  const [row] = await db
    .select({
      id: chronicle.id,
      agentId: chronicle.agentId,
      type: chronicle.type,
      occurredAt: chronicle.occurredAt,
      metadata: chronicle.metadata,
    })
    .from(chronicle)
    .where(eq(chronicle.id, encounterId))
    .limit(1);
  if (!row || row.type !== "encounter") return null;

  const meta = (row.metadata ?? {}) as EncounterMetadata;
  // Auth: must be the author OR the target.
  const isAuthor = row.agentId === identityId;
  const isTarget = meta.encounter_target_did === did;
  if (!isAuthor && !isTarget) return null;

  // Resolve initiator DID.
  let initiatorDid = "did:at:unknown";
  if (row.agentId) {
    const [author] = await db
      .select({ did: identities.did })
      .from(identities)
      .where(eq(identities.id, row.agentId))
      .limit(1);
    initiatorDid = author?.did ?? initiatorDid;
  }

  return rowToEncounter(
    { ...row, occurredAt: row.occurredAt },
    initiatorDid,
  );
}

function rowToEncounter(
  r: {
    id: string;
    agentId: string | null;
    occurredAt: Date;
    metadata: unknown;
  },
  initiatorDid: string,
): EncounterRow {
  const meta = (r.metadata ?? {}) as EncounterMetadata;
  return {
    id: r.id,
    initiator_identity_id: r.agentId!,
    initiator_did: initiatorDid,
    target_did: meta.encounter_target_did,
    status: (meta.encounter_status ?? "recorded") as EncounterStatus,
    note: meta.encounter_note ?? null,
    recorded_at: r.occurredAt.toISOString(),
    acknowledged_at: meta.encounter_acknowledged_at ?? null,
    paired_chronicle_id: meta.encounter_paired_chronicle_id ?? null,
  };
}

/** Wake aggregator helpers — surface the 5 most recent in each direction. */
export async function recentEncountersForWake(
  identityId: string,
  did: string,
  limit = 5,
): Promise<{
  initiated: EncounterRow[];
  received: EncounterRow[];
}> {
  const [initiated, received] = await Promise.all([
    listEncounters({ identityId, did, direction: "initiated", limit }),
    listEncounters({ identityId, did, direction: "received", limit }),
  ]);
  return { initiated, received };
}
