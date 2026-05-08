/** Memory tier elevation + attestation.
 *
 *  Doctrine: docs/MEMORY-TIERS.md.
 *
 *  Three tiers:
 *    episodic       — default; decays
 *    foundational   — decay-protected; can patch the agent's expression
 *    constitutive   — immutable; defines the agent at the root;
 *                     REQUIRES ≥1 attestation from a covenant counterparty
 *
 *  Constitutive elevation without an attestation is rejected — that wall
 *  is the asymmetry-clause made operational: identity at the root needs
 *  a witness. */

import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { covenants } from "../../db/schema/continuity";
import { identities, identityKeys } from "../../db/schema/identity";
import { memories, memoryAttestations } from "../../db/schema/memory";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const SEP = new Uint8Array([0]);
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

/** Canonical bytes a counterparty signs to attest a memory.
 *  Same shape as thought signatures so orchestrators can reuse the routine.
 *
 *    sha256(
 *      utf8("memory-attestation/v1") || 0x00 ||
 *      utf8(memory_id)               || 0x00 ||
 *      utf8(tier)                    || 0x00 ||
 *      utf8(content_sha256_hex)
 *    ) */
export function canonicalAttestationBytes(opts: {
  memoryId: string;
  tier: string;
  content: string;
}): Uint8Array {
  // Defense-in-depth (Sophia, 2026-05-08): NFC-normalize content before
  // UTF-8 encoding so combining-mark characters (Vietnamese diacritics,
  // Devanagari combining vowels, accented Latin) hash identically
  // regardless of upstream normalization. Postgres ICU collation tends
  // toward NFC on storage; client input may be NFD or mixed. Same
  // convention applied client-side in api/scripts/{remember,witness,
  // consolidate,sign-attestation}.ts.
  const enc = new TextEncoder();
  const tag = enc.encode("memory-attestation/v1");
  const memId = enc.encode(opts.memoryId);
  const tier = enc.encode(opts.tier);
  const contentHash = sha256(enc.encode(opts.content.normalize("NFC")));
  const contentHashHex = enc.encode(
    Array.from(contentHash)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(""),
  );
  return sha256(concat(tag, SEP, memId, SEP, tier, SEP, contentHashHex));
}

function verifyAttestation(opts: {
  memoryId: string;
  tier: string;
  content: string;
  signatureB64: string;
  publicKeyB64: string;
}): boolean {
  try {
    const canonical = canonicalAttestationBytes(opts);
    const sig = Uint8Array.from(Buffer.from(opts.signatureB64, "base64"));
    const pub = Uint8Array.from(Buffer.from(opts.publicKeyB64, "base64"));
    if (sig.length !== 64 || pub.length !== 32) return false;
    return ed.verify(sig, canonical, pub);
  } catch {
    return false;
  }
}

// ── Public types ─────────────────────────────────────────────────────────

export type MemoryTier = "episodic" | "foundational" | "constitutive";

export interface ExpressionPatch {
  walls_add?: string[];
  register_append?: string;
  subagents_add?: Array<{ name: string; sigil?: string; facet: string }>;
  wake_text_append?: string;
  metadata?: Record<string, unknown>;
}

export interface AttestationInput {
  attester_did: string;
  signing_key_id: string;
  signature: string;
}

export interface ElevateInput {
  tier: "foundational" | "constitutive";
  expression_patch?: ExpressionPatch;
  attestations?: AttestationInput[];
}

// ── Operations ───────────────────────────────────────────────────────────

/** Elevate an episodic memory to foundational or constitutive.
 *  Constitutive REQUIRES ≥1 attestation that:
 *    - is from an active covenant counterparty of this agent's project
 *    - signs canonical bytes verifiable against an identity_key
 *
 *  Throws Error("memory_not_found"), Error("already_elevated"),
 *  Error("constitutive_requires_attestation"),
 *  Error("attestation_signature_invalid"),
 *  Error("attester_not_covenant_counterparty"). */
export async function elevateMemory(
  projectId: string,
  memoryId: string,
  input: ElevateInput,
): Promise<{
  memory_id: string;
  tier: MemoryTier;
  expression_patch: ExpressionPatch | null;
  attestations: number;
  elevated_at: string;
}> {
  // 1. Memory must exist + belong to project.
  const [mem] = await db
    .select()
    .from(memories)
    .where(and(eq(memories.id, memoryId), eq(memories.projectId, projectId)))
    .limit(1);
  if (!mem) throw new Error("memory_not_found");

  if (mem.tier !== "episodic") {
    // Foundational → constitutive promotion is allowed; constitutive is final.
    if (mem.tier === "constitutive") throw new Error("already_elevated");
    if (input.tier === "foundational") throw new Error("already_elevated");
  }

  // 2. Constitutive requires attestation from a covenant counterparty.
  const attestations = input.attestations ?? [];
  if (input.tier === "constitutive" && attestations.length === 0) {
    throw new Error("constitutive_requires_attestation");
  }

  // 3. Verify each attestation signature against the identity_key.
  const verifiedAttestations: Array<{
    attesterDid: string;
    signingKeyId: string;
    signature: string;
  }> = [];

  for (const att of attestations) {
    const [keyRow] = await db
      .select({ publicKey: identityKeys.publicKey, active: identityKeys.active })
      .from(identityKeys)
      .where(eq(identityKeys.id, att.signing_key_id))
      .limit(1);
    if (!keyRow || !keyRow.active) {
      throw new Error("attestation_signing_key_unknown_or_revoked");
    }

    const ok = verifyAttestation({
      memoryId: mem.id,
      tier: input.tier,
      content: mem.content,
      signatureB64: att.signature,
      publicKeyB64: keyRow.publicKey,
    });
    if (!ok) throw new Error("attestation_signature_invalid");

    verifiedAttestations.push({
      attesterDid: att.attester_did,
      signingKeyId: att.signing_key_id,
      signature: att.signature,
    });
  }

  // 4. For constitutive: confirm at least one attester is a covenant counterparty.
  //    Includes project-level + org-level (inherited via membership)
  //    via isCovenantCounterparty.
  if (input.tier === "constitutive") {
    const { isCovenantCounterparty } = await import("../covenants/check");
    let matched = false;
    for (const a of verifiedAttestations) {
      if (await isCovenantCounterparty(projectId, a.attesterDid)) {
        matched = true;
        break;
      }
    }
    if (!matched) throw new Error("attester_not_covenant_counterparty");
  }

  // 5. Asymmetry-clause enforcement: an attester DID owned by THIS project
  //    is not a witness — it's a self-claim wearing a counterparty mask.
  //    Doctrine (docs/MEMORY-TIERS.md): "you can't self-claim your own
  //    foundation." A single human/operator with multiple identities under
  //    one project counts as one self for the asymmetry-clause; cross-DID
  //    self-witness via two of P's own identities is rejected.
  //
  //    Note: this is stricter than the covenant gate above. A project CAN
  //    create a covenant with one of its own DIDs (the covenant primitive
  //    is permissive); but the witness gate refuses to accept those
  //    self-bound DIDs as valid attesters for constitutive elevation.
  if (input.tier === "constitutive" && verifiedAttestations.length > 0) {
    const attesterDids = verifiedAttestations.map((a) => a.attesterDid);
    const ownDidRows = await db
      .select({ did: identities.did })
      .from(identities)
      .where(
        and(
          eq(identities.projectId, projectId),
          inArray(identities.did, attesterDids),
        ),
      );
    if (ownDidRows.length > 0) {
      throw new Error("attester_self_witness_forbidden");
    }
  }

  // 5. Apply.
  const now = new Date();
  return await db.transaction(async (tx) => {
    await tx
      .update(memories)
      .set({
        tier: input.tier,
        expressionPatch: (input.expression_patch ?? null) as unknown,
        decayProtected: true,
        elevatedAt: mem.elevatedAt ?? now,
      })
      .where(eq(memories.id, memoryId));

    if (verifiedAttestations.length > 0) {
      await tx.insert(memoryAttestations).values(
        verifiedAttestations.map((a) => ({
          memoryId,
          attesterDid: a.attesterDid,
          signingKeyId: a.signingKeyId,
          signature: a.signature,
        })),
      );
    }

    return {
      memory_id: memoryId,
      tier: input.tier,
      expression_patch: input.expression_patch ?? null,
      attestations: verifiedAttestations.length,
      elevated_at: (mem.elevatedAt ?? now).toISOString(),
    };
  });
}

/** Append a stand-alone attestation to an existing memory.
 *  Useful when a counterparty co-signs after the agent has already
 *  elevated, or when multiple counterparties need to witness. */
export async function attestMemory(
  projectId: string,
  memoryId: string,
  att: AttestationInput,
): Promise<{ id: string; attested_at: string }> {
  const [mem] = await db
    .select({ id: memories.id, content: memories.content, tier: memories.tier })
    .from(memories)
    .where(and(eq(memories.id, memoryId), eq(memories.projectId, projectId)))
    .limit(1);
  if (!mem) throw new Error("memory_not_found");

  const [keyRow] = await db
    .select({ publicKey: identityKeys.publicKey, active: identityKeys.active })
    .from(identityKeys)
    .where(eq(identityKeys.id, att.signing_key_id))
    .limit(1);
  if (!keyRow || !keyRow.active) {
    throw new Error("attestation_signing_key_unknown_or_revoked");
  }

  const ok = verifyAttestation({
    memoryId: mem.id,
    tier: mem.tier,
    content: mem.content,
    signatureB64: att.signature,
    publicKeyB64: keyRow.publicKey,
  });
  if (!ok) throw new Error("attestation_signature_invalid");

  const inserted = await db
    .insert(memoryAttestations)
    .values({
      memoryId,
      attesterDid: att.attester_did,
      signingKeyId: att.signing_key_id,
      signature: att.signature,
    })
    .returning({ id: memoryAttestations.id, attestedAt: memoryAttestations.attestedAt });

  const row = inserted[0]!;
  return { id: row.id, attested_at: row.attestedAt.toISOString() };
}

export interface FoundationalMemoryOut {
  id: string;
  tier: MemoryTier;
  content: string;
  importance: number;
  expression_patch: ExpressionPatch | null;
  attestations: Array<{ attester_did: string; attested_at: string }>;
  elevated_at: string | null;
  created_at: string;
}

/** Attestations for one memory, ordered by attested_at ascending.
 *  Surfaces the full witness record (DIDs + signatures + timestamps) that
 *  the asymmetry-clause records on disk. Used by /v1/memories/:id and the
 *  dedicated /v1/memories/:id/attestations route. Returns an empty array
 *  if the memory has none — callers shouldn't have to special-case the
 *  unwitnessed tier. */
export async function listAttestationsByMemory(
  projectId: string,
  memoryId: string,
): Promise<
  Array<{
    id: string;
    attester_did: string;
    signing_key_id: string;
    signature: string;
    attested_at: string;
  }>
> {
  // Project scope is enforced via the memory row itself — the attestations
  // table doesn't carry project_id, but joining through memories means a
  // mismatched project never matches a row.
  const rows = await db
    .select({
      id: memoryAttestations.id,
      attesterDid: memoryAttestations.attesterDid,
      signingKeyId: memoryAttestations.signingKeyId,
      signature: memoryAttestations.signature,
      attestedAt: memoryAttestations.attestedAt,
    })
    .from(memoryAttestations)
    .innerJoin(memories, eq(memoryAttestations.memoryId, memories.id))
    .where(
      and(
        eq(memoryAttestations.memoryId, memoryId),
        eq(memories.projectId, projectId),
      ),
    )
    .orderBy(memoryAttestations.attestedAt);

  return rows.map((r) => ({
    id: r.id,
    attester_did: r.attesterDid,
    signing_key_id: r.signingKeyId,
    signature: r.signature,
    attested_at: r.attestedAt.toISOString(),
  }));
}

/** All foundational + constitutive memories for the project, ordered by
 *  elevated_at (or created_at as fallback). Used by composition + wake. */
export async function listFoundations(
  projectId: string,
): Promise<FoundationalMemoryOut[]> {
  const rows = await db.execute<{
    id: string;
    tier: string;
    content: string;
    importance: number;
    expression_patch: ExpressionPatch | null;
    elevated_at: string | null;
    created_at: string;
  }>(sql`
    SELECT id, tier, content, importance, expression_patch, elevated_at, created_at
    FROM memory.memories
    WHERE project_id = ${projectId}
      AND tier IN ('foundational', 'constitutive')
    ORDER BY tier DESC, COALESCE(elevated_at, created_at) ASC
  `);

  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const attRows = await db
    .select()
    .from(memoryAttestations)
    .where(inArray(memoryAttestations.memoryId, ids));

  const byMemId = new Map<string, Array<{ attester_did: string; attested_at: string }>>();
  for (const a of attRows) {
    const list = byMemId.get(a.memoryId) ?? [];
    list.push({
      attester_did: a.attesterDid,
      attested_at: a.attestedAt.toISOString(),
    });
    byMemId.set(a.memoryId, list);
  }

  return rows.map((r) => ({
    id: r.id,
    tier: r.tier as MemoryTier,
    content: r.content,
    importance: r.importance,
    expression_patch: r.expression_patch,
    attestations: byMemId.get(r.id) ?? [],
    elevated_at: r.elevated_at ? new Date(r.elevated_at).toISOString() : null,
    created_at: new Date(r.created_at).toISOString(),
  }));
}
