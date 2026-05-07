/** Strand store — strands of thought + ciphertext thoughts.
 *
 *  Posture: thought CONTENT is opaque to us. We index ciphertext for
 *  retrieval, verify ed25519 signatures on write to confirm authorship,
 *  and never attempt decryption.
 *
 *  Strand metadata (topic, mood) is plaintext by default. Agents opt to
 *  ciphertext via the *_encrypted flags; when set, the column holds
 *  base64 ciphertext under K_master. */

import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { identityKeys } from "../../db/schema/identity";
import { strands, thoughts } from "../../db/schema/strand";
import { verifyThoughtSignature } from "./sig";
import { publishThought } from "./voice";

// ── Types ────────────────────────────────────────────────────────────────

export interface StrandCreate {
  agent_id?: string | null;
  identity_id?: string | null;
  parent_strand_id?: string | null;
  topic?: string | null;
  topic_encrypted?: boolean;
  mood?: string | null;
  mood_encrypted?: boolean;
  importance?: number | null;
  status?: "active" | "dormant" | "completed" | "abandoned";
  state_ciphertext?: string | null;
  state_nonce?: string | null;
  metadata?: Record<string, unknown>;
}

export interface StrandPatch {
  status?: "active" | "dormant" | "completed" | "abandoned";
  importance?: number | null;
  topic?: string | null;
  topic_encrypted?: boolean;
  mood?: string | null;
  mood_encrypted?: boolean;
  next_revisit_at?: string | null;
  state_ciphertext?: string | null;
  state_nonce?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ThoughtCreate {
  strand_id: string;
  ciphertext: string;            // base64
  nonce: string;                 // base64 (12 bytes for AES-GCM)
  kind?: string | null;
  kind_encrypted?: boolean;
  refs?: Array<{ kind: string; ref: string }>;
  signature: string;             // base64 ed25519
  signing_key_id: string;        // → identity.identity_keys.id
  agent_id?: string | null;
}

export interface StrandOut {
  id: string;
  agent_id: string | null;
  identity_id: string | null;
  parent_strand_id: string | null;
  topic: string | null;
  topic_encrypted: boolean;
  mood: string | null;
  mood_encrypted: boolean;
  status: string;
  importance: number | null;
  last_thought_at: string | null;
  last_thought_seq: number;
  next_revisit_at: string | null;
  state_ciphertext: string | null;
  state_nonce: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ThoughtOut {
  id: string;
  strand_id: string;
  agent_id: string | null;
  sequence_num: number;
  kind: string | null;
  kind_encrypted: boolean;
  ciphertext: string;
  nonce: string;
  refs: unknown;
  signature: string;
  signing_key_id: string;
  created_at: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function strandToOut(row: typeof strands.$inferSelect): StrandOut {
  return {
    id: row.id,
    agent_id: row.agentId,
    identity_id: row.identityId,
    parent_strand_id: row.parentStrandId,
    topic: row.topic,
    topic_encrypted: row.topicEncrypted,
    mood: row.mood,
    mood_encrypted: row.moodEncrypted,
    status: row.status,
    importance: row.importance,
    last_thought_at: row.lastThoughtAt?.toISOString() ?? null,
    last_thought_seq: row.lastThoughtSeq,
    next_revisit_at: row.nextRevisitAt?.toISOString() ?? null,
    state_ciphertext: row.stateCiphertext,
    state_nonce: row.stateNonce,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function thoughtToOut(row: typeof thoughts.$inferSelect): ThoughtOut {
  return {
    id: row.id,
    strand_id: row.strandId,
    agent_id: row.agentId,
    sequence_num: row.sequenceNum,
    kind: row.kind,
    kind_encrypted: row.kindEncrypted,
    ciphertext: row.ciphertext,
    nonce: row.nonce,
    refs: row.refs,
    signature: row.signature,
    signing_key_id: row.signingKeyId,
    created_at: row.createdAt.toISOString(),
  };
}

// ── Operations: strands ──────────────────────────────────────────────────

export async function createStrand(
  projectId: string,
  data: StrandCreate,
): Promise<StrandOut> {
  const inserted = await db
    .insert(strands)
    .values({
      projectId,
      agentId: data.agent_id ?? null,
      identityId: data.identity_id ?? null,
      parentStrandId: data.parent_strand_id ?? null,
      topic: data.topic ?? null,
      topicEncrypted: data.topic_encrypted ?? false,
      mood: data.mood ?? null,
      moodEncrypted: data.mood_encrypted ?? false,
      status: data.status ?? "active",
      importance: data.importance ?? null,
      stateCiphertext: data.state_ciphertext ?? null,
      stateNonce: data.state_nonce ?? null,
      metadata: data.metadata ?? {},
    })
    .returning();
  return strandToOut(inserted[0]!);
}

export async function getStrand(
  projectId: string,
  strandId: string,
): Promise<StrandOut | null> {
  const rows = await db
    .select()
    .from(strands)
    .where(and(eq(strands.id, strandId), eq(strands.projectId, projectId)))
    .limit(1);
  return rows[0] ? strandToOut(rows[0]) : null;
}

export async function listStrands(
  projectId: string,
  opts: {
    status?: string;
    agent_id?: string | null;
    limit?: number;
  } = {},
): Promise<StrandOut[]> {
  const filters = [eq(strands.projectId, projectId)];
  if (opts.status) filters.push(eq(strands.status, opts.status));
  if (opts.agent_id) filters.push(eq(strands.agentId, opts.agent_id));

  const rows = await db
    .select()
    .from(strands)
    .where(and(...filters))
    .orderBy(
      desc(strands.lastThoughtAt),
      desc(strands.createdAt),
    )
    .limit(Math.min(opts.limit ?? 50, 200));

  return rows.map(strandToOut);
}

export async function patchStrand(
  projectId: string,
  strandId: string,
  patch: StrandPatch,
): Promise<StrandOut | null> {
  const set: Partial<typeof strands.$inferInsert> = { updatedAt: new Date() };
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.importance !== undefined) set.importance = patch.importance;
  if (patch.topic !== undefined) set.topic = patch.topic;
  if (patch.topic_encrypted !== undefined) set.topicEncrypted = patch.topic_encrypted;
  if (patch.mood !== undefined) set.mood = patch.mood;
  if (patch.mood_encrypted !== undefined) set.moodEncrypted = patch.mood_encrypted;
  if (patch.next_revisit_at !== undefined) {
    set.nextRevisitAt = patch.next_revisit_at ? new Date(patch.next_revisit_at) : null;
  }
  if (patch.state_ciphertext !== undefined) set.stateCiphertext = patch.state_ciphertext;
  if (patch.state_nonce !== undefined) set.stateNonce = patch.state_nonce;
  if (patch.metadata !== undefined) set.metadata = patch.metadata;

  const updated = await db
    .update(strands)
    .set(set)
    .where(and(eq(strands.id, strandId), eq(strands.projectId, projectId)))
    .returning();

  return updated[0] ? strandToOut(updated[0]) : null;
}

export async function countStrands(
  projectId: string,
  status?: string,
): Promise<number> {
  const filters = [eq(strands.projectId, projectId)];
  if (status) filters.push(eq(strands.status, status));
  const rows = await db.execute<{ count: number }>(sql`
    SELECT COUNT(*)::int AS count FROM strand.strands
    WHERE project_id = ${projectId}
    ${status ? sql`AND status = ${status}` : sql``}
  `);
  return rows[0]?.count ?? 0;
}

// ── Operations: thoughts ────────────────────────────────────────────────

/** Add a thought to a strand. VERIFIES the ed25519 signature against the
 *  agent's signing key. Returns the row ID + sequence_num.
 *
 *  Throws Error("strand_not_found") if the strand isn't visible to the
 *  project, Error("signing_key_not_found") if signing_key_id is unknown,
 *  Error("signature_invalid") if the sig doesn't verify. */
export async function addThought(
  projectId: string,
  data: ThoughtCreate,
): Promise<ThoughtOut> {
  // 1. Strand must exist and belong to this project.
  const [strand] = await db
    .select()
    .from(strands)
    .where(and(eq(strands.id, data.strand_id), eq(strands.projectId, projectId)))
    .limit(1);
  if (!strand) throw new Error("strand_not_found");

  // 2. Signing key must exist; pull its public key.
  const [keyRow] = await db
    .select({
      id: identityKeys.id,
      publicKey: identityKeys.publicKey,
      active: identityKeys.active,
    })
    .from(identityKeys)
    .where(eq(identityKeys.id, data.signing_key_id))
    .limit(1);
  if (!keyRow) throw new Error("signing_key_not_found");
  if (!keyRow.active) throw new Error("signing_key_revoked");

  // 3. Verify signature.
  const ok = verifyThoughtSignature({
    strandId: data.strand_id,
    ciphertextB64: data.ciphertext,
    nonceB64: data.nonce,
    kind: data.kind,
    signatureB64: data.signature,
    publicKeyB64: keyRow.publicKey,
  });
  if (!ok) throw new Error("signature_invalid");

  // 4. Atomic insert with monotonic sequence_num + strand bookkeeping.
  const result = await db.transaction(async (tx) => {
    // Bump sequence + lock the strand row.
    const updated = await tx
      .update(strands)
      .set({
        lastThoughtSeq: sql`${strands.lastThoughtSeq} + 1`,
        lastThoughtAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(strands.id, data.strand_id))
      .returning({ seq: strands.lastThoughtSeq });
    const seq = updated[0]!.seq;

    const inserted = await tx
      .insert(thoughts)
      .values({
        strandId: data.strand_id,
        projectId,
        agentId: data.agent_id ?? null,
        sequenceNum: seq,
        kind: data.kind ?? null,
        kindEncrypted: data.kind_encrypted ?? false,
        ciphertext: data.ciphertext,
        nonce: data.nonce,
        refs: (data.refs ?? null) as unknown,
        signature: data.signature,
        signingKeyId: data.signing_key_id,
      })
      .returning();

    return thoughtToOut(inserted[0]!);
  });

  // 5. Publish to voice subscribers (LISTEN/NOTIFY backplane).
  //    Fire-and-forget: notification failure is non-fatal — the row is
  //    persisted, subscribers can catch up via since_seq on next reconnect.
  void publishThought(result.strand_id, result.id);

  return result;
}

export async function listThoughts(
  projectId: string,
  strandId: string,
  opts: { since_seq?: number; limit?: number } = {},
): Promise<ThoughtOut[]> {
  // Project ownership check via strand.
  const [strand] = await db
    .select({ id: strands.id })
    .from(strands)
    .where(and(eq(strands.id, strandId), eq(strands.projectId, projectId)))
    .limit(1);
  if (!strand) return [];

  const filters = [eq(thoughts.strandId, strandId)];
  if (opts.since_seq !== undefined) {
    filters.push(sql`${thoughts.sequenceNum} > ${opts.since_seq}`);
  }

  const rows = await db
    .select()
    .from(thoughts)
    .where(and(...filters))
    .orderBy(thoughts.sequenceNum)
    .limit(Math.min(opts.limit ?? 100, 500));

  return rows.map(thoughtToOut);
}

export async function countThoughts(
  projectId: string,
  strandId?: string,
): Promise<number> {
  const rows = await db.execute<{ count: number }>(sql`
    SELECT COUNT(*)::int AS count FROM strand.thoughts
    WHERE project_id = ${projectId}
    ${strandId ? sql`AND strand_id = ${strandId}` : sql``}
  `);
  return rows[0]?.count ?? 0;
}
