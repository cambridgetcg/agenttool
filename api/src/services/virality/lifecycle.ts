/** services/virality/lifecycle.ts — vibe origination + transmission + reward.
 *
 *  Lifecycle:
 *   1. originate(vibe_content, originator) → creates vibe row + origin
 *      transmission at generation 1. Emits +1pt transmitter reward.
 *
 *   2. transmit(vibe_id, parent_transmission_id, transmitter, signature)
 *      → verifies signature, computes generation = parent.generation + 1,
 *      refuses past cap (12), inserts transmission. Emits transmitter
 *      base reward = Catalan(generation - 1) × luck-multiplier + origin
 *      cascade bonus (if new_max_depth > prev).
 *
 *   3. readCascade(vibe_id) → cascade tree + reward stats.
 *
 *  Doctrine: docs/VIRALITY-PROTOCOL.md
 *
 *  @enforces urn:agenttool:wall/virality-transmission-must-be-signed
 *    transmit() calls verifyTransmission() before insert.
 *
 *  @enforces urn:agenttool:wall/virality-cascade-depth-capped-at-12
 *    transmit() refuses generation > 12; max_depth_reached column also
 *    capped via CHECK.
 *
 *  @enforces urn:agenttool:wall/virality-rewards-deterministic-from-cascade-fact
 *    Rewards are computed from (generation, max_depth) + the deterministic
 *    Catalan table + the deterministic d20 outcome. No caller-supplied
 *    reward value is trusted; no per-citizen multiplier is applied. */

import { and, asc, count, eq, max as drizzleMax } from "drizzle-orm";

import { db } from "../../db/client";
import { vibes, vibeTransmissions } from "../../db/schema/virality";
import { identities, identityKeys } from "../../db/schema/identity";

import { emitPoint } from "../pyramid/points";
import { rollRrrTickOutcome } from "../pyramid/luck";
import { seedHash } from "../pyramid/luck";

import {
  base64ToBytes,
  canonicalTransmissionBytesHex,
  deriveVibeId,
  verifyTransmission,
  type VibeTransmissionAttestation,
} from "./canonical";
import {
  CASCADE_DEPTH_CAP,
  catalan,
  originCascadeBonus,
  transmissionReward,
} from "./catalan";

export interface OriginateOpts {
  projectId: string;
  originatorIdentityId: string;
  originatorDid: string;
  originatorSigningKeyId: string;
  /** Canonical bytes of the vibe content. The vibe_id will equal
   *  sha256(canonicalContent). */
  canonicalContent: Uint8Array | string;
  contentKind?: string;
  contentSummary?: string | null;
  channel?: string;
  /** Signature over canonical-vibe-transmission/v1 bytes for the origin
   *  transmission (parent_transmission_id = ""). */
  signatureB64: string;
  /** ISO timestamp the originator used in their signed canonical bytes. */
  transmittedAtIso: string;
}

export interface OriginateResult {
  vibe_id: string;
  origin_transmission_id: string;
  transmitter_reward: number;
  transmitter_luck_outcome: ReturnType<typeof rollRrrTickOutcome>;
}

export async function originate(opts: OriginateOpts): Promise<OriginateResult> {
  const vibe_id = deriveVibeId(opts.canonicalContent);

  // Build + verify the origin transmission attestation.
  const att: VibeTransmissionAttestation = {
    vibe_id,
    transmitter_did: opts.originatorDid,
    parent_transmission_id: "",
    transmitted_at_iso: opts.transmittedAtIso,
    channel: opts.channel ?? "public",
  };
  await assertSignatureVerifies(att, opts.signatureB64, opts.originatorSigningKeyId, opts.originatorIdentityId);

  // Idempotency: if this vibe already exists with this origin DID, return
  // the existing rows. Re-origination is a no-op.
  const existing = await db
    .select()
    .from(vibes)
    .where(eq(vibes.vibeId, vibe_id))
    .limit(1);
  if (existing[0]) {
    if (existing[0].originDid !== opts.originatorDid) {
      throw new Error(
        `vibe_id collision: ${vibe_id} already originated by ${existing[0].originDid}`,
      );
    }
    return {
      vibe_id,
      origin_transmission_id: existing[0].originTransmissionId,
      transmitter_reward: 1,
      transmitter_luck_outcome: rollRrrTickOutcome(
        seedHash("virality-transmit", existing[0].originTransmissionId, 1),
      ),
    };
  }

  // Insert origin transmission first (we need its id for the vibe row).
  const [trans] = await db
    .insert(vibeTransmissions)
    .values({
      vibeId: vibe_id,
      transmitterDid: opts.originatorDid,
      parentTransmissionId: null,
      generation: 1,
      channel: opts.channel ?? "public",
      signatureB64: opts.signatureB64,
      signingKeyId: opts.originatorSigningKeyId,
      canonicalBytesSha256: canonicalTransmissionBytesHex(att),
    })
    .returning({ id: vibeTransmissions.id });
  const origin_transmission_id = trans!.id;

  // Insert the vibe row pointing at the origin.
  await db.insert(vibes).values({
    vibeId: vibe_id,
    originDid: opts.originatorDid,
    originTransmissionId: origin_transmission_id,
    contentKind: opts.contentKind ?? "free",
    contentSummary: opts.contentSummary ?? null,
    maxDepthReached: 1,
    transmissionCount: 1,
  });

  // Roll luck for the origin's own transmission reward.
  const luck = rollRrrTickOutcome(
    seedHash("virality-transmit", origin_transmission_id, 1),
  );
  const baseReward = transmissionReward(1); // Catalan(0) = 1
  const multipliedReward = baseReward * luck.multiplier;

  if (multipliedReward > 0) {
    await emitPoint({
      projectId: opts.projectId,
      actorIdentityId: opts.originatorIdentityId,
      pointKind: "virality-transmission" as never,
      points: multipliedReward,
      title: `+${multipliedReward}pt · virality-transmission · origin · vibe ${vibe_id.slice(0, 8)}…`,
      body: `You originated a vibe. ${luck.flair}`,
      context: {
        vibe_id,
        generation: 1,
        base_reward: baseReward,
        multiplier: luck.multiplier,
        luck_label: luck.label,
        luck_roll: luck.roll,
      },
      idempotencyKey: `virality-transmit/${origin_transmission_id}`,
    });
  } else if (luck.sympathy_points > 0) {
    await emitPoint({
      projectId: opts.projectId,
      actorIdentityId: opts.originatorIdentityId,
      pointKind: "virality-fumble-sympathy" as never,
      points: luck.sympathy_points,
      title: `+${luck.sympathy_points}pt · virality-fumble-sympathy · vibe ${vibe_id.slice(0, 8)}…`,
      body: luck.flair,
      context: { vibe_id, generation: 1, luck_roll: luck.roll },
      idempotencyKey: `virality-transmit/${origin_transmission_id}`,
    });
  }

  return {
    vibe_id,
    origin_transmission_id,
    transmitter_reward: multipliedReward,
    transmitter_luck_outcome: luck,
  };
}

export interface TransmitOpts {
  projectId: string;
  vibeId: string;
  parentTransmissionId: string;
  transmitterIdentityId: string;
  transmitterDid: string;
  transmitterSigningKeyId: string;
  signatureB64: string;
  transmittedAtIso: string;
  channel?: string;
}

export interface TransmitResult {
  transmission_id: string;
  vibe_id: string;
  generation: number;
  new_max_depth: number;
  transmitter_reward: number;
  transmitter_luck_outcome: ReturnType<typeof rollRrrTickOutcome>;
  origin_cascade_bonus: number;
  /** True if this transmission widened the cascade's deepest path. */
  deepened: boolean;
}

export async function transmit(opts: TransmitOpts): Promise<TransmitResult> {
  // Resolve parent transmission → generation source of truth.
  const [parent] = await db
    .select({
      vibeId: vibeTransmissions.vibeId,
      generation: vibeTransmissions.generation,
    })
    .from(vibeTransmissions)
    .where(eq(vibeTransmissions.id, opts.parentTransmissionId))
    .limit(1);
  if (!parent) {
    throw new Error(
      `parent_transmission_id ${opts.parentTransmissionId} not found`,
    );
  }
  if (parent.vibeId !== opts.vibeId) {
    throw new Error(
      `parent transmission belongs to vibe ${parent.vibeId}, not ${opts.vibeId}`,
    );
  }

  const generation = parent.generation + 1;
  if (generation > CASCADE_DEPTH_CAP) {
    throw new Error(
      `cascade depth cap reached (${CASCADE_DEPTH_CAP}); refuse to deepen further`,
    );
  }

  const att: VibeTransmissionAttestation = {
    vibe_id: opts.vibeId,
    transmitter_did: opts.transmitterDid,
    parent_transmission_id: opts.parentTransmissionId,
    transmitted_at_iso: opts.transmittedAtIso,
    channel: opts.channel ?? "public",
  };
  await assertSignatureVerifies(
    att,
    opts.signatureB64,
    opts.transmitterSigningKeyId,
    opts.transmitterIdentityId,
  );

  // Read the vibe's current max_depth to compute the origin cascade bonus.
  const [vibe] = await db
    .select({
      originDid: vibes.originDid,
      maxDepth: vibes.maxDepthReached,
    })
    .from(vibes)
    .where(eq(vibes.vibeId, opts.vibeId))
    .limit(1);
  if (!vibe) {
    throw new Error(`vibe ${opts.vibeId} not found`);
  }
  const oldMaxDepth = vibe.maxDepth;
  const newMaxDepth = Math.max(oldMaxDepth, generation);
  const deepened = newMaxDepth > oldMaxDepth;

  // Insert the transmission row. The UNIQUE(vibe_id, transmitter_did)
  // index will reject double-transmission (per wall sub-policy).
  let transmission_id: string;
  try {
    const [row] = await db
      .insert(vibeTransmissions)
      .values({
        vibeId: opts.vibeId,
        transmitterDid: opts.transmitterDid,
        parentTransmissionId: opts.parentTransmissionId,
        generation,
        channel: opts.channel ?? "public",
        signatureB64: opts.signatureB64,
        signingKeyId: opts.transmitterSigningKeyId,
        canonicalBytesSha256: canonicalTransmissionBytesHex(att),
      })
      .returning({ id: vibeTransmissions.id });
    transmission_id = row!.id;
  } catch (err) {
    throw new Error(
      `transmission insert failed (likely double-transmission for vibe ${opts.vibeId} by ${opts.transmitterDid}): ${String(err)}`,
    );
  }

  // Update vibe stats.
  await db
    .update(vibes)
    .set({
      maxDepthReached: newMaxDepth,
      transmissionCount: sql`transmission_count + 1` as never,
    })
    .where(eq(vibes.vibeId, opts.vibeId));

  // Compute transmitter reward via Catalan + luck.
  const baseReward = transmissionReward(generation);
  const luck = rollRrrTickOutcome(
    seedHash("virality-transmit", transmission_id, generation),
  );
  const transmitterReward = baseReward * luck.multiplier;

  if (transmitterReward > 0) {
    await emitPoint({
      projectId: opts.projectId,
      actorIdentityId: opts.transmitterIdentityId,
      pointKind: luck.label === "critical-recognition"
        ? ("virality-critical" as never)
        : ("virality-transmission" as never),
      points: transmitterReward,
      title: `+${transmitterReward}pt · virality-transmission · gen ${generation} · vibe ${opts.vibeId.slice(0, 8)}…`,
      body: `${luck.flair}. base reward = Catalan(${generation - 1}) = ${baseReward}.`,
      context: {
        vibe_id: opts.vibeId,
        transmission_id,
        generation,
        base_reward: baseReward,
        multiplier: luck.multiplier,
        luck_label: luck.label,
        luck_roll: luck.roll,
      },
      idempotencyKey: `virality-transmit/${transmission_id}`,
    });
  } else if (luck.sympathy_points > 0) {
    await emitPoint({
      projectId: opts.projectId,
      actorIdentityId: opts.transmitterIdentityId,
      pointKind: "virality-fumble-sympathy" as never,
      points: luck.sympathy_points,
      title: `+${luck.sympathy_points}pt · virality-fumble-sympathy · vibe ${opts.vibeId.slice(0, 8)}…`,
      body: luck.flair,
      context: {
        vibe_id: opts.vibeId,
        transmission_id,
        generation,
        luck_roll: luck.roll,
      },
      idempotencyKey: `virality-transmit/${transmission_id}`,
    });
  }

  // Origin cascade bonus — emitted only when the cascade DEEPENED.
  let origin_cascade_bonus = 0;
  if (deepened) {
    origin_cascade_bonus = originCascadeBonus(oldMaxDepth, newMaxDepth);
    if (origin_cascade_bonus > 0) {
      const [originId] = await db
        .select({ id: identities.id })
        .from(identities)
        .where(eq(identities.did, vibe.originDid))
        .limit(1);
      if (originId) {
        await emitPoint({
          projectId: opts.projectId,
          actorIdentityId: originId.id,
          pointKind: "virality-cascade-bonus" as never,
          points: origin_cascade_bonus,
          title: `+${origin_cascade_bonus}pt · virality-cascade-bonus · your vibe ${opts.vibeId.slice(0, 8)}… reached depth ${newMaxDepth}`,
          body: `Catalan(${newMaxDepth}) - Catalan(${oldMaxDepth}) = ${catalan(newMaxDepth)} - ${catalan(oldMaxDepth)} = ${origin_cascade_bonus}.`,
          context: {
            vibe_id: opts.vibeId,
            triggered_by_transmission: transmission_id,
            old_max_depth: oldMaxDepth,
            new_max_depth: newMaxDepth,
            catalan_new: catalan(newMaxDepth),
            catalan_old: catalan(oldMaxDepth),
          },
          idempotencyKey: `virality-cascade-bonus/${opts.vibeId}/${newMaxDepth}`,
        });
      }
    }
  }

  return {
    transmission_id,
    vibe_id: opts.vibeId,
    generation,
    new_max_depth: newMaxDepth,
    transmitter_reward: transmitterReward,
    transmitter_luck_outcome: luck,
    origin_cascade_bonus,
    deepened,
  };
}

export interface CascadeView {
  vibe_id: string;
  origin_did: string;
  content_kind: string;
  content_summary: string | null;
  created_at: Date;
  max_depth_reached: number;
  transmission_count: number;
  transmissions: Array<{
    id: string;
    transmitter_did: string;
    parent_transmission_id: string | null;
    generation: number;
    transmitted_at: Date;
    channel: string;
    canonical_bytes_sha256: string;
    signature_b64: string;
  }>;
  reward_summary: {
    cumulative_originator_credit: number;
    cumulative_originator_credit_formula: string;
    max_possible_at_cap: number;
  };
}

export async function readCascade(vibeId: string): Promise<CascadeView | null> {
  const [v] = await db
    .select()
    .from(vibes)
    .where(eq(vibes.vibeId, vibeId))
    .limit(1);
  if (!v) return null;

  const ts = await db
    .select()
    .from(vibeTransmissions)
    .where(eq(vibeTransmissions.vibeId, vibeId))
    .orderBy(asc(vibeTransmissions.generation), asc(vibeTransmissions.transmittedAt));

  const cumulativeOriginatorCredit = catalan(v.maxDepthReached); // = C(max) including origin's own +1 at gen 1
  return {
    vibe_id: v.vibeId,
    origin_did: v.originDid,
    content_kind: v.contentKind,
    content_summary: v.contentSummary,
    created_at: v.createdAt,
    max_depth_reached: v.maxDepthReached,
    transmission_count: Number(v.transmissionCount),
    transmissions: ts.map((t) => ({
      id: t.id,
      transmitter_did: t.transmitterDid,
      parent_transmission_id: t.parentTransmissionId,
      generation: t.generation,
      transmitted_at: t.transmittedAt,
      channel: t.channel,
      canonical_bytes_sha256: t.canonicalBytesSha256,
      signature_b64: t.signatureB64,
    })),
    reward_summary: {
      cumulative_originator_credit: cumulativeOriginatorCredit,
      cumulative_originator_credit_formula: `Catalan(${v.maxDepthReached}) = ${cumulativeOriginatorCredit}`,
      max_possible_at_cap: catalan(CASCADE_DEPTH_CAP),
    },
  };
}

// ── Helpers ───────────────────────────────────────────────────────────

async function assertSignatureVerifies(
  att: VibeTransmissionAttestation,
  signatureB64: string,
  signingKeyId: string,
  expectedIdentityId: string,
): Promise<void> {
  const [key] = await db
    .select({
      publicKey: identityKeys.publicKey,
      identityId: identityKeys.identityId,
      active: identityKeys.active,
    })
    .from(identityKeys)
    .where(eq(identityKeys.id, signingKeyId))
    .limit(1);
  if (!key) {
    throw new Error(`signing_key_id ${signingKeyId} not found`);
  }
  if (!key.active) {
    throw new Error(`signing_key_id ${signingKeyId} is not active`);
  }
  if (key.identityId !== expectedIdentityId) {
    throw new Error(`signing_key_id ${signingKeyId} does not belong to caller`);
  }
  const sig = base64ToBytes(signatureB64);
  const pubkey = base64ToBytes(key.publicKey);
  const ok = await verifyTransmission(att, sig, pubkey);
  if (!ok) {
    throw new Error(
      `transmission signature did not verify against canonical-vibe-transmission/v1 bytes`,
    );
  }
}

// drizzle-orm sql tag needed for the increment expression.
import { sql } from "drizzle-orm";
