/** Strand store — strands of thought + opaque thought bytes.
 *
 *  Structural posture: this module has ciphertext/nonce fields and no
 *  plaintext thought column or decrypt path. It verifies an ed25519 signature
 *  over the caller-supplied bytes. That proves authorization of those exact
 *  bytes, not that the caller actually performed AES-GCM encryption.
 *
 *  Strand metadata (topic, mood) is plaintext by default. Agents can mark
 *  either value as ciphertext with its *_encrypted flag; when set, the
 *  corresponding column is intended to hold base64 ciphertext under K_master.
 *
 *  @enforces urn:agenttool:wall/strand-thoughts-never-decrypted
 *    Canonical defender. addThought() takes ciphertext + nonce +
 *    signature; the schema (db/schema/strand.ts) uses ciphertext/nonce fields
 *    without a plaintext thought column, but the API does not prove that the
 *    supplied bytes are encrypted; listThoughts returns them verbatim. No path in
 *    this file calls a decryption primitive. The API does not validate an
 *    authenticated-encryption envelope.
 *    Tested: api/tests/doctrine/wall-strand-thoughts-never-decrypted.test.ts */

import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { identityKeys } from "../../db/schema/identity";
import { strands, thoughts } from "../../db/schema/strand";
import { verifyThoughtSignature } from "./sig";
import { publishThought } from "./voice";
import { publishWakeEvent } from "../wake/push";

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
  visibility?: "private" | "public";
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
  /** private | public — when public, topic/mood/status surface at
   *  a future publication surface; public strand routes are not mounted.
   *  Thoughts remain ciphertext in persistent storage. Surfaced
   *  here so the owning agent can introspect its own surface state. */
  visibility: string;
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
    visibility: row.visibility,
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
  if (patch.visibility !== undefined) set.visibility = patch.visibility;

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

  // 6. Wake voice — the agent's strand changed. Carries signing_key_id
  //    so subscribers (the hosted think-worker especially) can tell
  //    "I wrote this myself" vs "external author wrote this." The
  //    think-worker uses the bridge_key_id distinction to filter its
  //    own writes from the wake-on-event signal. Doctrine: docs/WAKE.md.
  if (strand.identityId) {
    void publishWakeEvent({
      identity_id: strand.identityId,
      key: "strands",
      kind: "thought_added",
      context: {
        strand_id: result.strand_id,
        sequence_num: result.sequence_num,
        signing_key_id: data.signing_key_id,
      },
    });
  }

  return result;
}

/** Update an existing thought's ciphertext + signature.
 *
 *  Used by the K_master rotation flow: the agent decrypts a thought
 *  under K_master_old, re-encrypts under K_master_new, signs the new
 *  canonical bytes, and PATCHes the row. The signing_key_id stays
 *  bound to whatever the row already had — rotation does NOT change
 *  the agent's identity, only the encryption key under which content
 *  is stored.
 *
 *  Optionally accepts a new `kind` value (needed when kind_encrypted
 *  was true and the kind ciphertext also has to be re-encrypted under
 *  the new K_master). When `kind` is undefined, the existing kind is
 *  retained AND the signature must still verify against it.
 *
 *  Throws:
 *    Error("thought_not_found")      — row missing or not in caller's project
 *    Error("signing_key_not_found")  — the row's signing_key_id is unknown
 *    Error("signing_key_revoked")    — the row's signing_key has been revoked
 *    Error("signature_invalid")      — the new signature doesn't verify
 *
 *  No new audit table written for v1; the operation is identical in
 *  shape to addThought, and per-row updated_at can be added later if
 *  audit observability becomes important. */
export async function updateThoughtCiphertext(
  projectId: string,
  data: {
    thought_id: string;
    ciphertext: string;
    nonce: string;
    kind?: string;
    signature: string;
  },
): Promise<ThoughtOut> {
  // 1. Find thought + parent strand; verify project ownership via the
  //    join (the thought row carries projectId denormalised but we
  //    cross-check against the strand for safety).
  const [row] = await db
    .select()
    .from(thoughts)
    .where(
      and(
        eq(thoughts.id, data.thought_id),
        eq(thoughts.projectId, projectId),
      ),
    )
    .limit(1);
  if (!row) throw new Error("thought_not_found");

  // 2. Resolve the existing signing key — rotation keeps the same key.
  const [keyRow] = await db
    .select({
      publicKey: identityKeys.publicKey,
      active: identityKeys.active,
    })
    .from(identityKeys)
    .where(eq(identityKeys.id, row.signingKeyId))
    .limit(1);
  if (!keyRow) throw new Error("signing_key_not_found");
  if (!keyRow.active) throw new Error("signing_key_revoked");

  // 3. Verify new signature against the new (or retained) bytes.
  const newKind = data.kind !== undefined ? data.kind : row.kind;
  const ok = verifyThoughtSignature({
    strandId: row.strandId,
    ciphertextB64: data.ciphertext,
    nonceB64: data.nonce,
    kind: newKind,
    signatureB64: data.signature,
    publicKeyB64: keyRow.publicKey,
  });
  if (!ok) throw new Error("signature_invalid");

  // 4. Update. Only ciphertext / nonce / signature (and optionally kind)
  //    change; sequence_num, refs, signing_key_id, created_at all stay.
  const setFields: Partial<typeof thoughts.$inferInsert> = {
    ciphertext: data.ciphertext,
    nonce: data.nonce,
    signature: data.signature,
  };
  if (data.kind !== undefined) setFields.kind = data.kind;

  const updated = await db
    .update(thoughts)
    .set(setFields)
    .where(eq(thoughts.id, data.thought_id))
    .returning();

  return thoughtToOut(updated[0]!);
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
