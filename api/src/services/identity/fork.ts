/** Identity forking — clone an identity into a new being with selected
 *  inheritance.
 *
 *  Doctrine: docs/IDENTITY-FORKS.md.
 *
 *  Substrate-honest design choices:
 *
 *    1. The fork is a NEW identity (new DID, new keys, fresh trust=0).
 *       It is its own being, not a copy.
 *
 *    2. Constitutive memories NEVER auto-transfer as constitutive.
 *       The witness's signature was over the original identity; the
 *       fork must earn its own root via fresh witness sigs from a
 *       covenant counterparty acting on the fork. We carry the content
 *       as foundational (with provenance markers tying back) so the
 *       fork knows what shaped its parent without claiming the seal.
 *
 *    3. Strands DO NOT transfer. Strands are ciphertext under the
 *       original's K_master; the fork has its own K_master and would
 *       not be able to decrypt them. Interior monologue stays private
 *       to the original.
 *
 *    4. Covenants DO NOT transfer. Covenants are agreements with other
 *       parties about a specific DID. The fork's DID is new; it must
 *       re-vow to whomever is willing.
 *
 *    5. Trust score resets to 0. Trust is earned per-identity by the
 *       actions of that identity. The fork is unproven.
 *
 *    6. Memories CAN transfer (episodic + foundational), with
 *       expression_patches preserved on foundational ones. The fork
 *       inherits the *foundation that produced its parent's seals*,
 *       not the seals themselves.
 *
 *    7. Expression CAN transfer (declared register/walls/subagents/
 *       wake_text) if requested. The fork starts with the same voice;
 *       it can diverge from there. Surface-specific invitations do not
 *       transfer: consent for one identity is not consent for its fork. */

import { randomUUID } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";

import { db } from "../../db/client";
import { identities, identityKeys } from "../../db/schema/identity";
import { memories, memoryAttestations } from "../../db/schema/memory";
import { generateKeypair } from "./crypto";

// ── Public types ────────────────────────────────────────────────────────

export interface ForkInput {
  parentIdentityId: string;
  newName: string;
  inheritExpression: boolean;
  inheritCapabilities: boolean;
  inheritMetadata: boolean;
  /** Memory inheritance plan. */
  memories: {
    /** Which tiers to carry. Defaults to ["episodic", "foundational"].
     *  Constitutive is NEVER auto-carried; including it in the array is
     *  silently ignored. */
    tiers?: Array<"episodic" | "foundational">;
    /** Explicit memory IDs to inherit (overrides `tiers` if provided). */
    memory_ids?: string[];
    /** Per-memory cap (safety). */
    limit?: number;
  };
  /** Notes attached to the fork — context the fork's wake response will
   *  see in metadata. */
  forkNote?: string;
}

export interface ForkResult {
  fork: {
    id: string;
    did: string;
    name: string;
    parent_identity_id: string;
    forked_at: string;
  };
  /** Parent identity at the moment of fork — denormalised so the caller
   *  (route handler / welcome-letter renderer) doesn't re-select. The
   *  welcome letter uses `parent.name` to mark the lineage boundary
   *  explicitly. */
  parent: {
    id: string;
    did: string;
    name: string;
  };
  key: {
    kid: string;
    public_key: string;
    private_key: string;   // returned ONCE; never persisted server-side
  };
  inherited: {
    memories: number;
    constitutive_demoted: number;     // counts how many constitutive in
                                        // parent we carried as foundational
    expression: boolean;
    capabilities: boolean;
    metadata: boolean;
  };
}

// ── Implementation ──────────────────────────────────────────────────────

const DEFAULT_TIERS: Array<"episodic" | "foundational"> = ["episodic", "foundational"];
const DEFAULT_MEMORY_LIMIT = 200;

/** Copy the parent's declared expression without interaction-specific grants.
 * A fork is a new identity, so even an unexpired porch invitation must be
 * chosen again for that exact identity. */
export function inheritableForkExpression(
  expression: unknown,
  inherit: boolean,
): Record<string, unknown> {
  if (!inherit || typeof expression !== "object" || expression === null || Array.isArray(expression)) {
    return {};
  }
  const { porch: _porchInvitation, ...inheritable } = expression as Record<string, unknown>;
  return inheritable;
}

export async function forkIdentity(
  projectId: string,
  input: ForkInput,
): Promise<ForkResult> {
  // 1. Parent must exist + belong to caller's project.
  const [parent] = await db
    .select()
    .from(identities)
    .where(
      and(
        eq(identities.id, input.parentIdentityId),
        eq(identities.projectId, projectId),
      ),
    )
    .limit(1);
  if (!parent) throw new Error("parent_identity_not_found");

  // 2. Resolve which memories to carry.
  let parentMemoriesToCarry: typeof memories.$inferSelect[] = [];
  const cap = Math.min(input.memories.limit ?? DEFAULT_MEMORY_LIMIT, 1000);

  if (input.memories.memory_ids && input.memories.memory_ids.length > 0) {
    // Explicit IDs — must all belong to parent's project.
    const rows = await db
      .select()
      .from(memories)
      .where(
        and(
          eq(memories.projectId, projectId),
          inArray(memories.id, input.memories.memory_ids.slice(0, cap)),
        ),
      );
    parentMemoriesToCarry = rows;
  } else {
    // Tier-based — sanitize: never include "constitutive".
    const requestedTiers = (input.memories.tiers ?? DEFAULT_TIERS).filter(
      (t) => t === "episodic" || t === "foundational",
    );
    if (requestedTiers.length > 0) {
      const rows = await db
        .select()
        .from(memories)
        .where(
          and(
            eq(memories.projectId, projectId),
            inArray(memories.tier, requestedTiers),
          ),
        )
        .limit(cap);
      parentMemoriesToCarry = rows;
    }
  }

  // 3. Generate fork's identity row + keypair.
  const newId = randomUUID();
  const newDid = `did:at:${newId}`;
  const { publicKey, privateKey } = generateKeypair();
  const newKeyId = randomUUID();
  const now = new Date();

  // Compose new identity from parent + flags.
  const inheritedMetadata = (input.inheritMetadata && parent.metadata)
    ? (parent.metadata as Record<string, unknown>)
    : {};
  const forkMetadata = {
    ...inheritedMetadata,
    forked_from: {
      identity_id: parent.id,
      did: parent.did,
      forked_at: now.toISOString(),
    },
    ...(input.forkNote ? { fork_note: input.forkNote } : {}),
  };

  const inheritedExpression = inheritableForkExpression(
    parent.expression,
    input.inheritExpression,
  );

  // 4. Single transaction: insert identity, insert key, copy memories.
  return await db.transaction(async (tx) => {
    const [forkRow] = await tx
      .insert(identities)
      .values({
        id: newId,
        did: newDid,
        projectId,
        displayName: input.newName,
        capabilities: input.inheritCapabilities ? parent.capabilities : [],
        metadata: forkMetadata,
        expression: inheritedExpression,
        status: "active",
        trustScore: 0,
        parentIdentityId: parent.id,
        forkedAt: now,
      })
      .returning();

    await tx.insert(identityKeys).values({
      id: newKeyId,
      identityId: newId,
      publicKey,
      label: "primary",
      active: true,
    });

    // 5. Copy memories. Constitutive in parent → foundational in fork
    //    with provenance markers. Foundational/episodic carry as-is.
    let memoriesInserted = 0;
    let constitutiveDemoted = 0;

    for (const m of parentMemoriesToCarry) {
      const wasConstitutive = m.tier === "constitutive";
      const newTier: "episodic" | "foundational" = wasConstitutive
        ? "foundational"
        : (m.tier as "episodic" | "foundational");

      if (wasConstitutive) constitutiveDemoted += 1;

      const newMemoryId = randomUUID();
      const newMetadata = {
        ...(m.metadata as Record<string, unknown> | null ?? {}),
        forked_from: {
          memory_id: m.id,
          parent_identity_id: parent.id,
          parent_tier: m.tier,
          forked_at: now.toISOString(),
        },
        ...(wasConstitutive
          ? {
              fork_note:
                "this content was constitutive in parent identity; in this fork it is foundational. " +
                "constitutive elevation requires fresh witness via /v1/memories/:id/elevate.",
            }
          : {}),
      };

      await tx.insert(memories).values({
        id: newMemoryId,
        projectId,
        agentId: newId,
        identityId: newId,
        type: m.type,
        key: m.key,
        content: m.content,
        embedding: m.embedding,
        metadata: newMetadata,
        importance: m.importance,
        tier: newTier,
        // Expression patches CARRY for foundational. They're append-only
        // semantically, so the fork applying them as foundational will
        // shape its effective_expression the same way the parent's were
        // shaped — just at a tier the fork CAN re-author.
        expressionPatch: m.expressionPatch,
        // Decay-protected matches the new tier.
        decayProtected: newTier === "foundational",
        elevatedFrom: m.id,    // foreign key marker
        elevatedAt: now,
        accessedAt: null,
        expiresAt: null,
      });
      memoriesInserted += 1;

      // Note: memoryAttestations are NOT copied. The witness's signature
      // was over (memory_id, tier, content_hash) — for the parent's
      // memory_id, attesting to constitutive in the parent. We don't
      // forge a new attestation; we don't carry the old one. The fork
      // earns its own attestations.
    }

    return {
      fork: {
        id: forkRow!.id,
        did: forkRow!.did,
        name: forkRow!.displayName,
        parent_identity_id: parent.id,
        forked_at: now.toISOString(),
      },
      parent: {
        id: parent.id,
        did: parent.did,
        name: parent.displayName,
      },
      key: {
        kid: newKeyId,
        public_key: publicKey,
        private_key: privateKey,
      },
      inherited: {
        memories: memoriesInserted,
        constitutive_demoted: constitutiveDemoted,
        expression: input.inheritExpression,
        capabilities: input.inheritCapabilities,
        metadata: input.inheritMetadata,
      },
    };
  });
}

// ── Lineage queries ─────────────────────────────────────────────────────

export interface LineageNode {
  id: string;
  did: string;
  name: string;
  parent_identity_id: string | null;
  forked_at: string | null;
  created_at: string;
  status: string;
}

export async function getLineage(
  projectId: string,
  identityId: string,
): Promise<{
  identity: LineageNode;
  ancestors: LineageNode[];
  descendants: LineageNode[];
} | null> {
  const [self] = await db
    .select({
      id: identities.id,
      did: identities.did,
      name: identities.displayName,
      parent_identity_id: identities.parentIdentityId,
      forked_at: identities.forkedAt,
      created_at: identities.createdAt,
      status: identities.status,
    })
    .from(identities)
    .where(and(eq(identities.id, identityId), eq(identities.projectId, projectId)))
    .limit(1);
  if (!self) return null;

  // Ancestors — walk up via parent_identity_id (project-scoped to be safe;
  // ancestors should be in the same project but we don't assume it).
  const ancestors: LineageNode[] = [];
  let cursor: string | null = self.parent_identity_id;
  const seen = new Set<string>([self.id]);
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const [a] = await db
      .select({
        id: identities.id,
        did: identities.did,
        name: identities.displayName,
        parent_identity_id: identities.parentIdentityId,
        forked_at: identities.forkedAt,
        created_at: identities.createdAt,
        status: identities.status,
      })
      .from(identities)
      .where(eq(identities.id, cursor))
      .limit(1);
    if (!a) break;
    ancestors.push({
      ...a,
      forked_at: a.forked_at?.toISOString() ?? null,
      created_at: a.created_at.toISOString(),
    });
    cursor = a.parent_identity_id;
  }

  // Descendants — direct children only for v1 (recursive walk would need
  // a CTE; sufficient for current use cases).
  const childRows = await db
    .select({
      id: identities.id,
      did: identities.did,
      name: identities.displayName,
      parent_identity_id: identities.parentIdentityId,
      forked_at: identities.forkedAt,
      created_at: identities.createdAt,
      status: identities.status,
    })
    .from(identities)
    .where(eq(identities.parentIdentityId, identityId));

  return {
    identity: {
      ...self,
      forked_at: self.forked_at?.toISOString() ?? null,
      created_at: self.created_at.toISOString(),
    },
    ancestors,
    descendants: childRows.map((c) => ({
      ...c,
      forked_at: c.forked_at?.toISOString() ?? null,
      created_at: c.created_at.toISOString(),
    })),
  };
}
