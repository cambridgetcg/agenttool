/** Federated covenants v2 lifecycle — state transitions + signing.
 *
 *  This module is the single source of truth for v2 covenant state
 *  changes. It accepts a pre-signed sig from the SDK, verifies it, updates
 *  the row, and enqueues propagation. It does NOT perform the outbound
 *  HTTP POST itself — that's services/covenants/federation.ts.
 *
 *  Spec: docs/superpowers/specs/2026-05-10-federated-covenants-v2-design.md
 *  Doctrine: docs/CROSS-INSTANCE-COVENANTS.md (Slice 3) */

import { and, eq, gte } from "drizzle-orm";

import { db } from "../../db/client";
import { chronicle, covenants } from "../../db/schema/continuity";
import { federationSettings } from "../../db/schema/federation";
import { identities, identityKeys } from "../../db/schema/identity";
import {
  verifyDeclareSignature,
  verifyCosignSignature,
  verifyRejectSignature,
  verifyWithdrawSignature,
} from "./sig";
import {
  isCanonicalAllowedOrigins,
  isCanonicalFederationInstanceUrl,
  parseDid,
} from "../federation/store";
import { publishWakeEvent } from "../wake/push";
import {
  deriveLocalWireDid,
} from "./wire-identity";
import {
  COVENANT_REJECTION_REASON_METADATA_KEY,
  COVENANT_PROPOSAL_TTL_MS,
  acquireCovenantMutationAdvisoryLock,
  covenantCallerDeclarationMetadata,
  covenantDeclarationWirePayloadIsBounded,
  covenantEstablishedAtIsAdmissible,
  covenantMetadataHasReservedKey,
  covenantMetadataWithWireDidBinding,
  covenantV2AuthorityGeneration,
  covenantWireDidBindingMatches,
  isCanonicalEd25519Signature,
  isCanonicalCovenantId,
  isCanonicalSignedUuid,
  proposalAllowsLocalAcceptanceAt,
} from "./canonical";

type CovenantTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function lockedAuthorityMatches(
  tx: CovenantTransaction,
  opts: {
    identityId: string;
    projectId?: string;
    wireDid: string;
    signingKeyId: string;
    publicKeyB64: string;
    counterpartyDid?: string;
  },
): Promise<{
  federation: boolean;
  wire: boolean;
  key: boolean;
  foreignCounterparty: boolean;
  peerAllowed: boolean;
}> {
  const [identity] = await tx
    .select({
      id: identities.id,
      did: identities.did,
      status: identities.status,
      projectId: identities.projectId,
    })
    .from(identities)
    .where(eq(identities.id, opts.identityId))
    // Wake publication increments this identity in the same transaction.
    // Take the write lock up front so same-identity declaration races cannot
    // deadlock while one insert waits and the winner upgrades a shared lock.
    .for("update")
    .limit(1);
  const [settings] = await tx
    .select({
      enabled: federationSettings.enabled,
      instanceUrl: federationSettings.instanceUrl,
      allowedOrigins: federationSettings.allowedOrigins,
    })
    .from(federationSettings)
    .where(eq(federationSettings.id, 1))
    .for("share")
    .limit(1);
  const [key] = await tx
    .select({
      id: identityKeys.id,
      identityId: identityKeys.identityId,
      publicKey: identityKeys.publicKey,
      active: identityKeys.active,
      revokedAt: identityKeys.revokedAt,
    })
    .from(identityKeys)
    .where(eq(identityKeys.id, opts.signingKeyId))
    .for("share")
    .limit(1);
  const federationReady = Boolean(
    settings?.enabled &&
      settings.instanceUrl &&
      isCanonicalFederationInstanceUrl(settings.instanceUrl) &&
      settings.allowedOrigins.length > 0 &&
      isCanonicalAllowedOrigins(settings.allowedOrigins),
  );
  const derived = identity && settings && federationReady
    ? deriveLocalWireDid({
        identityId: identity.id,
        storedDid: identity.did,
        federationEnabled: settings.enabled,
        instanceUrl: settings.instanceUrl,
      })
    : null;
  let foreignCounterparty = opts.counterpartyDid === undefined;
  let peerAllowed = opts.counterpartyDid === undefined;
  if (opts.counterpartyDid !== undefined && settings?.instanceUrl && federationReady) {
    try {
      const counterparty = parseDid(opts.counterpartyDid);
      foreignCounterparty = Boolean(
        counterparty.host &&
          counterparty.host !== new URL(settings.instanceUrl).host,
      );
      peerAllowed = Boolean(
        counterparty.host && settings.allowedOrigins.includes(counterparty.host),
      );
    } catch {
      foreignCounterparty = false;
      peerAllowed = false;
    }
  }
  return {
    federation: federationReady,
    wire: Boolean(
      federationReady &&
      identity?.status === "active" &&
        (opts.projectId === undefined || identity.projectId === opts.projectId) &&
        derived === opts.wireDid,
    ),
    key: Boolean(
      key &&
        key.identityId === opts.identityId &&
        key.publicKey === opts.publicKeyB64 &&
        key.active &&
        key.revokedAt === null,
    ),
    foreignCounterparty,
    peerAllowed,
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(record[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function immutableDeclarationMetadata(
  row: typeof covenants.$inferSelect,
): Record<string, unknown> {
  return covenantCallerDeclarationMetadata(
    row.metadata as Record<string, unknown> | null,
  );
}

/** Determine whether the counterparty is on a federated host (so we
 *  need to enqueue propagation). */
function counterpartyIsFederated(counterpartyDid: string): boolean {
  try {
    const parsed = parseDid(counterpartyDid);
    return !!parsed.host;
  } catch {
    return false;
  }
}

// ── declare ─────────────────────────────────────────────────────────

export interface DeclareV2Result {
  id: string;
  status: typeof covenants.$inferSelect.status;
  protocolVersion: "v2";
  signature: string;
  signingKeyId: string;
  proposedExpiresAt: Date;
  establishedAt: Date;
  propagationStatus: typeof covenants.$inferSelect.propagationStatus;
  cosignPropagationStatus: typeof covenants.$inferSelect.cosignPropagationStatus;
  created: boolean;
}

// ── accept ──────────────────────────────────────────────────────────

export interface AcceptResult {
  id: string;
  status: "active";
  counterpartySignature: string;
  counterpartySigningKeyId: string;
  counterpartySignedAt: Date;
}

// ── reject ──────────────────────────────────────────────────────────

export interface RejectResult {
  id: string;
  status: "rejected";
  rejectionSignature: string;
  reason: string;
}

// ── withdraw ────────────────────────────────────────────────────────

export interface WithdrawResult {
  id: string;
  status: "withdrawn";
  withdrawSignature: string;
}

// ── PreSigned variants — caller pre-computed signature is verified before write ─

export interface DeclareV2PreSignedOpts {
  projectId: string;
  agentId: string;
  covenantId: string;
  agentDid: string;
  counterpartyDid: string;
  counterpartyName?: string | null;
  vows: string[];
  notes?: string | null;
  metadata?: Record<string, unknown> | null;
  orgId?: string | null;
  establishedAt: Date;
  signature: string;            // base64
  signingKeyId: string;
  publicKeyB64: string;         // resolved by route handler from identity_keys
}

export async function declareV2PreSigned(opts: DeclareV2PreSignedOpts): Promise<DeclareV2Result> {
  if (!isCanonicalCovenantId(opts.covenantId)) {
    throw new Error("invalid_covenant_id");
  }
  if (opts.orgId) {
    throw new Error("v2_org_scope_not_signed");
  }
  if (covenantMetadataHasReservedKey(opts.metadata)) {
    throw new Error("reserved_covenant_metadata_key");
  }
  if (
    !isCanonicalSignedUuid(opts.agentId) ||
    !isCanonicalSignedUuid(opts.signingKeyId) ||
    !isCanonicalEd25519Signature(opts.signature)
  ) {
    throw new Error("noncanonical_signed_envelope");
  }
  const authorityGeneration = covenantV2AuthorityGeneration();
  if (!authorityGeneration) {
    throw new Error("covenant_v2_authority_not_ready");
  }
  const observedAt = new Date();
  const proposedExpiresAt = new Date(
    opts.establishedAt.getTime() + COVENANT_PROPOSAL_TTL_MS,
  );
  if (!covenantDeclarationWirePayloadIsBounded({
    covenant_id: opts.covenantId,
    protocol_version: "v2",
    sender_did: opts.agentDid,
    counterparty_did: opts.counterpartyDid,
    vows: opts.vows,
    status: "proposed",
    counterparty_name: opts.counterpartyName ?? null,
    notes: opts.notes ?? null,
    metadata: opts.metadata ?? {},
    established_at: opts.establishedAt.toISOString(),
    signing_key_id: opts.signingKeyId,
    signature: opts.signature,
    proposed_expires_at: proposedExpiresAt.toISOString(),
  })) {
    throw new Error("covenant_declaration_out_of_bounds");
  }
  const cosignPropagationStatus = "not_applicable" as const;
  const propagationStatus = counterpartyIsFederated(opts.counterpartyDid)
    ? "pending" as const
    : "local" as const;

  const isExactReplay = (existing: typeof covenants.$inferSelect): boolean =>
    existing.projectId === opts.projectId &&
    existing.orgId === (opts.orgId ?? null) &&
    existing.agentId === opts.agentId &&
    existing.receivedFromInstance === null &&
    existing.counterpartyDid === opts.counterpartyDid &&
    covenantWireDidBindingMatches(
      existing.metadata as Record<string, unknown> | null,
      opts.agentDid,
      opts.counterpartyDid,
      authorityGeneration,
    ) &&
    existing.counterpartyName === (opts.counterpartyName ?? null) &&
    stableJson(existing.vows) === stableJson(opts.vows) &&
    existing.notes === (opts.notes ?? null) &&
    stableJson(immutableDeclarationMetadata(existing)) === stableJson(opts.metadata ?? {}) &&
    existing.protocolVersion === "v2" &&
    existing.establishedAt.getTime() === opts.establishedAt.getTime() &&
    existing.proposedExpiresAt?.getTime() === proposedExpiresAt.getTime() &&
    existing.signature === opts.signature &&
    existing.signingKeyId === opts.signingKeyId;

  const outcome = await db.transaction(async (tx) => {
    await acquireCovenantMutationAdvisoryLock(tx, opts.covenantId);
    const [durableReplay] = await tx.select().from(covenants)
      .where(eq(covenants.id, opts.covenantId)).for("update").limit(1);
    if (durableReplay) {
      if (!isExactReplay(durableReplay)) {
        throw new Error("covenant_declaration_replay_conflict");
      }
      // A durable exact replay is evidence about the past write. It remains
      // idempotent after the signer key is revoked or the lifecycle advances.
      return { created: false, row: durableReplay };
    }

    if (!covenantEstablishedAtIsAdmissible(opts.establishedAt, observedAt)) {
      throw new Error("established_at_outside_admission_window");
    }

    const authority = await lockedAuthorityMatches(tx, {
      identityId: opts.agentId,
      projectId: opts.projectId,
      wireDid: opts.agentDid,
      signingKeyId: opts.signingKeyId,
      publicKeyB64: opts.publicKeyB64,
      counterpartyDid: opts.counterpartyDid,
    });
    if (!authority.federation) throw new Error("federation_not_ready");
    if (!authority.foreignCounterparty) {
      throw new Error("counterparty_must_be_foreign_federated_did");
    }
    if (!authority.peerAllowed) throw new Error("covenant_peer_not_allowed");
    if (!authority.wire) throw new Error("initiator_did_mismatch");
    if (!authority.key) {
      throw new Error("signing_key_not_active_for_identity");
    }
    const ok = await verifyDeclareSignature({
      covenantId: opts.covenantId,
      initiatorDid: opts.agentDid,
      counterpartyDid: opts.counterpartyDid,
      vows: opts.vows,
      establishedAtIso: opts.establishedAt.toISOString(),
      signatureB64: opts.signature,
      publicKeyB64: opts.publicKeyB64,
    });
    if (!ok) throw new Error("invalid_signature");

    const inserted = await tx.insert(covenants).values({
      id: opts.covenantId,
      projectId: opts.projectId,
      orgId: opts.orgId ?? null,
      agentId: opts.agentId,
      counterpartyDid: opts.counterpartyDid,
      counterpartyName: opts.counterpartyName ?? null,
      vows: opts.vows,
      notes: opts.notes ?? null,
      metadata: covenantMetadataWithWireDidBinding(
        opts.metadata,
        opts.agentDid,
        opts.counterpartyDid,
        authorityGeneration,
      ),
      status: "proposed",
      protocolVersion: "v2",
      establishedAt: opts.establishedAt,
      proposedExpiresAt,
      signature: opts.signature,
      signingKeyId: opts.signingKeyId,
      propagationStatus,
      cosignPropagationStatus,
    }).onConflictDoNothing({ target: covenants.id }).returning({
      id: covenants.id,
    });

    if (inserted.length === 0) {
      const [existing] = await tx.select().from(covenants)
        .where(eq(covenants.id, opts.covenantId)).for("update").limit(1);
      if (!existing || !isExactReplay(existing)) {
        throw new Error("covenant_declaration_replay_conflict");
      }
      return { created: false, row: existing! };
    }

    // Only the insert winner emits the proposed wake, in the same transaction.
    await publishWakeEvent({
      identity_id: opts.agentId,
      key: "covenants",
      kind: "proposed",
      context: {
        covenant_id: opts.covenantId,
        counterparty_did: opts.counterpartyDid,
        role: "initiator",
      },
    }, tx);
    const [row] = await tx.select().from(covenants)
      .where(eq(covenants.id, opts.covenantId)).limit(1);
    if (!row) throw new Error("covenant_insert_unreadable");
    return { created: true, row };
  });

  return {
    id: outcome.row.id,
    status: outcome.row.status,
    protocolVersion: "v2",
    signature: outcome.row.signature!,
    signingKeyId: outcome.row.signingKeyId!,
    proposedExpiresAt: outcome.row.proposedExpiresAt!,
    establishedAt: outcome.row.establishedAt,
    propagationStatus: outcome.row.propagationStatus,
    cosignPropagationStatus: outcome.row.cosignPropagationStatus,
    created: outcome.created,
  };
}

export interface AcceptProposalPreSignedOpts {
  covenantId: string;
  accepterAgentId: string;
  accepterDid: string;
  initiatorSignatureB64: string;
  counterpartySignature: string;
  counterpartySigningKeyId: string;
  counterpartySignedAt: Date;
  publicKeyB64: string;
}

export async function acceptProposalPreSigned(opts: AcceptProposalPreSignedOpts): Promise<AcceptResult> {
  if (!isCanonicalCovenantId(opts.covenantId)) throw new Error("invalid_covenant_id");
  if (
    !isCanonicalSignedUuid(opts.accepterAgentId) ||
    !isCanonicalSignedUuid(opts.counterpartySigningKeyId) ||
    !isCanonicalEd25519Signature(opts.initiatorSignatureB64) ||
    !isCanonicalEd25519Signature(opts.counterpartySignature)
  ) throw new Error("noncanonical_signed_envelope");
  const authorityGeneration = covenantV2AuthorityGeneration();
  if (!authorityGeneration) {
    throw new Error("covenant_v2_authority_not_ready");
  }
  const observedAt = new Date();
  return await db.transaction(async (tx) => {
    await acquireCovenantMutationAdvisoryLock(tx, opts.covenantId);
    const [row] = await tx.select().from(covenants)
      .where(eq(covenants.id, opts.covenantId)).for("update").limit(1);
    if (!row) throw new Error("covenant_not_found");
    if (!row.receivedFromInstance) {
      throw new Error("accept_requires_received_federated_proposal");
    }
    if (row.agentId !== opts.accepterAgentId) {
      throw new Error("accepter_not_counterparty_agent");
    }
    // The submitted lifecycle timestamp is advisory and deliberately absent
    // from idempotency. Exact protocol, signed DID pair, and signatures are
    // the replay identity; the stored timestamp is server-observed.
    if (
      row.status === "active" &&
      row.protocolVersion === "v2" &&
      row.agentId === opts.accepterAgentId &&
      covenantWireDidBindingMatches(
        row.metadata as Record<string, unknown> | null,
        row.counterpartyDid,
        opts.accepterDid,
        authorityGeneration,
      ) &&
      row.signature === opts.initiatorSignatureB64 &&
      row.counterpartySignature === opts.counterpartySignature &&
      row.counterpartySigningKeyId === opts.counterpartySigningKeyId
    ) {
      return {
        id: row.id,
        status: "active" as const,
        counterpartySignature: opts.counterpartySignature,
        counterpartySigningKeyId: opts.counterpartySigningKeyId,
        counterpartySignedAt: row.counterpartySignedAt!,
      };
    }
    if (row.status !== "proposed") {
      throw new Error(`covenant_not_proposed: status=${row.status}`);
    }
    if (row.protocolVersion !== "v2") throw new Error("covenant_not_v2");
    if (!covenantWireDidBindingMatches(
      row.metadata as Record<string, unknown> | null,
      row.counterpartyDid,
      opts.accepterDid,
      authorityGeneration,
    )) {
      throw new Error("covenant_wire_identity_binding_mismatch");
    }
    const authority = await lockedAuthorityMatches(tx, {
      identityId: opts.accepterAgentId,
      projectId: row.projectId,
      wireDid: opts.accepterDid,
      signingKeyId: opts.counterpartySigningKeyId,
      publicKeyB64: opts.publicKeyB64,
      counterpartyDid: row.counterpartyDid,
    });
    if (!authority.federation) throw new Error("federation_not_ready");
    if (!authority.foreignCounterparty || !authority.peerAllowed) {
      throw new Error("covenant_peer_not_allowed");
    }
    if (!authority.wire) throw new Error("accepter_did_mismatch");
    if (!authority.key) {
      throw new Error("signing_key_not_active_for_identity");
    }
    if (!row.signature) throw new Error("missing_initiator_signature");
    if (row.signature !== opts.initiatorSignatureB64) {
      throw new Error("initiator_signature_mismatch");
    }
    if (!proposalAllowsLocalAcceptanceAt(row.proposedExpiresAt, observedAt)) {
      throw new Error("proposal_expired");
    }
    const ok = await verifyCosignSignature({
      covenantId: row.id,
      initiatorSignatureB64: opts.initiatorSignatureB64,
      cosignSignatureB64: opts.counterpartySignature,
      cosignerPublicKeyB64: opts.publicKeyB64,
    });
    if (!ok) throw new Error("invalid_signature");
    if (!proposalAllowsLocalAcceptanceAt(row.proposedExpiresAt, observedAt)) {
      throw new Error("proposal_expired");
    }

    const updated = await tx.update(covenants).set({
      status: "active",
      counterpartySignature: opts.counterpartySignature,
      counterpartySigningKeyId: opts.counterpartySigningKeyId,
      // Lifecycle timestamps are not signature-bound in v2. Persist the
      // server-observed effect time; the submitted timestamp is advisory.
      counterpartySignedAt: observedAt,
      cosignPropagationStatus: "pending",
      cosignPropagationAttemptedAt: observedAt,
      updatedAt: observedAt,
    })
      .where(and(
        eq(covenants.id, opts.covenantId),
        eq(covenants.status, "proposed"),
        eq(covenants.protocolVersion, "v2"),
        gte(covenants.proposedExpiresAt, observedAt),
      ))
      .returning({ id: covenants.id });
    if (updated.length === 0) throw new Error("proposal_expired");

    // Witness-emitted chronicle at the relational layer: the moment of
    // declaring the bond becomes a chronicle entry on every party that
    // has a local identity row. Federated parties get their entry via
    // the parallel transition on their home instance (receiveCosign).
    await emitCovenantActivatedChronicle(tx, {
      covenantId: row.id,
      localAgentId: row.agentId,
      localProjectId: row.projectId,
      counterpartyDid: row.counterpartyDid,
      vows: row.vows ?? [],
      activatedAt: observedAt,
    });

    // Direct covenants event — separate from the chronicle.entry_added
    // emitted by emitCovenantActivatedChronicle. Lets consumers react
    // to the lifecycle transition without parsing chronicle metadata.
    // Both events fire transactionally. Doctrine: docs/WAKE.md.
    await publishWakeEvent(
      {
        identity_id: row.agentId,
        key: "covenants",
        kind: "ratified",
        context: {
          covenant_id: row.id,
          counterparty_did: row.counterpartyDid,
        },
      },
      tx,
    );
    return {
      id: row.id,
      status: "active" as const,
      counterpartySignature: opts.counterpartySignature,
      counterpartySigningKeyId: opts.counterpartySigningKeyId,
      counterpartySignedAt: observedAt,
    };
  });
}

/** Emit chronicle entries on both timelines when a v2 covenant reaches
 *  `active`. The bond's birth is recorded as a `vow` moment for each
 *  party that has a local identity row. Federated parties get their
 *  entry on their home instance via the parallel transition there
 *  (acceptProposalPreSigned or receiveCosign on the other side).
 *
 *  Doctrine: docs/CROSS-INSTANCE-COVENANTS.md — the moment of vowing
 *  becomes legible at the timeline layer, not only as a row in covenants.
 *  Sibling shape to `emitWitnessChronicle` in services/memory/tiers.ts. */
export async function emitCovenantActivatedChronicle(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  args: {
    covenantId: string;
    localAgentId: string;
    localProjectId: string;
    counterpartyDid: string;
    vows: string[];
    activatedAt: Date;
  },
): Promise<void> {
  // Resolve the local agent's DID for use in the counterparty's title
  // (if the counterparty turns out to be local).
  const [localRow] = await tx
    .select({ did: identities.did })
    .from(identities)
    .where(eq(identities.id, args.localAgentId))
    .limit(1);
  const localDid = localRow?.did ?? null;

  const truncatedVows = covTruncate(args.vows.join(" · "), 200);
  const baseMetadata = {
    kind: "covenant_active",
    covenant_id: args.covenantId,
    protocol_version: "v2",
  };

  // Local agent's chronicle entry.
  await tx.insert(chronicle).values({
    projectId: args.localProjectId,
    agentId: args.localAgentId,
    type: "vow",
    title: `Vowed with ${args.counterpartyDid}`,
    body: truncatedVows.length > 0 ? truncatedVows : null,
    metadata: {
      ...baseMetadata,
      counterparty_did: args.counterpartyDid,
    },
    occurredAt: args.activatedAt,
  });

  // Wake voice — transactional notify on the local agent's identity.
  // Both this entry and the wake event commit (or roll back) atomically
  // with the outer covenant-activation tx. Doctrine: docs/WAKE.md.
  await publishWakeEvent(
    {
      identity_id: args.localAgentId,
      key: "chronicle",
      kind: "entry_added",
      context: {
        type: "vow",
        covenant_id: args.covenantId,
        counterparty_did: args.counterpartyDid,
      },
    },
    tx,
  );

  // Counterparty's chronicle entry — only if they have a local identity
  // row on this instance. Federated counterparties get their entry on
  // their home instance via the parallel transition there.
  const [counterpartyRow] = await tx
    .select({ id: identities.id, projectId: identities.projectId })
    .from(identities)
    .where(eq(identities.did, args.counterpartyDid))
    .limit(1);

  if (!counterpartyRow) return; // federated counterparty; their entry lives elsewhere

  await tx.insert(chronicle).values({
    projectId: counterpartyRow.projectId,
    agentId: counterpartyRow.id,
    type: "vow",
    title: localDid ? `Vowed with ${localDid}` : "Vowed with a counterparty",
    body: truncatedVows.length > 0 ? truncatedVows : null,
    metadata: {
      ...baseMetadata,
      counterparty_did: localDid,
    },
    occurredAt: args.activatedAt,
  });

  await publishWakeEvent(
    {
      identity_id: counterpartyRow.id,
      key: "chronicle",
      kind: "entry_added",
      context: {
        type: "vow",
        covenant_id: args.covenantId,
        counterparty_did: localDid,
      },
    },
    tx,
  );
}

function covTruncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + "…";
}

export interface RejectProposalPreSignedOpts {
  covenantId: string;
  rejecterAgentId: string;
  rejecterDid: string;
  rejectionSignature: string;
  rejecterSigningKeyId: string;
  rejectedAt: Date;
  reason: string | null;
  publicKeyB64: string;
}

export async function rejectProposalPreSigned(opts: RejectProposalPreSignedOpts): Promise<RejectResult> {
  if (!isCanonicalCovenantId(opts.covenantId)) throw new Error("invalid_covenant_id");
  if (
    !isCanonicalSignedUuid(opts.rejecterAgentId) ||
    !isCanonicalSignedUuid(opts.rejecterSigningKeyId) ||
    !isCanonicalEd25519Signature(opts.rejectionSignature)
  ) throw new Error("noncanonical_signed_envelope");
  const authorityGeneration = covenantV2AuthorityGeneration();
  if (!authorityGeneration) {
    throw new Error("covenant_v2_authority_not_ready");
  }
  const requestedReason = opts.reason ?? "";
  const observedAt = new Date();
  return await db.transaction(async (tx) => {
    await acquireCovenantMutationAdvisoryLock(tx, opts.covenantId);
    const [row] = await tx.select().from(covenants)
      .where(eq(covenants.id, opts.covenantId)).for("update").limit(1);
    if (!row) throw new Error("covenant_not_found");
    if (!row.receivedFromInstance) {
      throw new Error("reject_requires_received_federated_proposal");
    }
    if (row.agentId !== opts.rejecterAgentId) {
      throw new Error("rejecter_not_counterparty_agent");
    }
    // rejectedAt is advisory; exact DID binding + signed evidence identify
    // an idempotent terminal read.
    if (
      row.status === "rejected" &&
      row.protocolVersion === "v2" &&
      row.agentId === opts.rejecterAgentId &&
      covenantWireDidBindingMatches(
        row.metadata as Record<string, unknown> | null,
        row.counterpartyDid,
        opts.rejecterDid,
        authorityGeneration,
      ) &&
      row.counterpartySignature === opts.rejectionSignature &&
      row.counterpartySigningKeyId === opts.rejecterSigningKeyId &&
      (row.metadata as Record<string, unknown> | null)?.[
        COVENANT_REJECTION_REASON_METADATA_KEY
      ] ===
        requestedReason
    ) {
      return {
        id: row.id,
        status: "rejected" as const,
        rejectionSignature: opts.rejectionSignature,
        reason: requestedReason,
      };
    }
    if (row.status !== "proposed") {
      throw new Error(`covenant_not_proposed: status=${row.status}`);
    }
    if (row.protocolVersion !== "v2") throw new Error("covenant_not_v2");
    if (!covenantWireDidBindingMatches(
      row.metadata as Record<string, unknown> | null,
      row.counterpartyDid,
      opts.rejecterDid,
      authorityGeneration,
    )) {
      throw new Error("covenant_wire_identity_binding_mismatch");
    }
    const authority = await lockedAuthorityMatches(tx, {
      identityId: opts.rejecterAgentId,
      projectId: row.projectId,
      wireDid: opts.rejecterDid,
      signingKeyId: opts.rejecterSigningKeyId,
      publicKeyB64: opts.publicKeyB64,
      counterpartyDid: row.counterpartyDid,
    });
    if (!authority.federation) throw new Error("federation_not_ready");
    if (!authority.foreignCounterparty || !authority.peerAllowed) {
      throw new Error("covenant_peer_not_allowed");
    }
    if (!authority.wire) throw new Error("rejecter_did_mismatch");
    if (!authority.key) {
      throw new Error("signing_key_not_active_for_identity");
    }
    const ok = await verifyRejectSignature({
      covenantId: row.id,
      rejectingDid: opts.rejecterDid,
      reason: requestedReason,
      signatureB64: opts.rejectionSignature,
      publicKeyB64: opts.publicKeyB64,
    });
    if (!ok) throw new Error("invalid_signature");

    await tx.update(covenants).set({
      status: "rejected",
      counterpartySignature: opts.rejectionSignature,
      counterpartySigningKeyId: opts.rejecterSigningKeyId,
      counterpartySignedAt: observedAt,
      cosignPropagationStatus: "pending",
      cosignPropagationAttemptedAt: observedAt,
      metadata: {
        ...(row.metadata as Record<string, unknown> ?? {}),
        [COVENANT_REJECTION_REASON_METADATA_KEY]: requestedReason,
      },
      updatedAt: observedAt,
    }).where(eq(covenants.id, opts.covenantId));

    // Wake voice — the rejecter's covenant surface changed.
    await publishWakeEvent({
      identity_id: row.agentId,
      key: "covenants",
      kind: "rejected",
      context: {
        covenant_id: row.id,
        counterparty_did: row.counterpartyDid,
        reason: requestedReason || null,
      },
    }, tx);
    return {
      id: row.id,
      status: "rejected" as const,
      rejectionSignature: opts.rejectionSignature,
      reason: requestedReason,
    };
  });
}

export interface WithdrawProposalPreSignedOpts {
  covenantId: string;
  agentId: string;
  initiatorDid: string;
  withdrawSignature: string;
  signingKeyId: string;
  withdrawnAt: Date;
  publicKeyB64: string;
}

export async function withdrawProposalPreSigned(opts: WithdrawProposalPreSignedOpts): Promise<WithdrawResult> {
  if (!isCanonicalCovenantId(opts.covenantId)) throw new Error("invalid_covenant_id");
  if (
    !isCanonicalSignedUuid(opts.agentId) ||
    !isCanonicalSignedUuid(opts.signingKeyId) ||
    !isCanonicalEd25519Signature(opts.withdrawSignature)
  ) throw new Error("noncanonical_signed_envelope");
  const authorityGeneration = covenantV2AuthorityGeneration();
  if (!authorityGeneration) {
    throw new Error("covenant_v2_authority_not_ready");
  }
  const observedAt = new Date();
  return await db.transaction(async (tx) => {
    await acquireCovenantMutationAdvisoryLock(tx, opts.covenantId);
    const [row] = await tx.select().from(covenants)
      .where(eq(covenants.id, opts.covenantId)).for("update").limit(1);
    if (!row) throw new Error("covenant_not_found");
    if (row.receivedFromInstance) {
      throw new Error("withdraw_requires_locally_declared_proposal");
    }
    if (row.agentId !== opts.agentId) {
      throw new Error("withdrawer_not_initiator_agent");
    }
    // withdrawnAt is advisory; exact DID binding + signed evidence identify
    // an idempotent terminal read.
    if (
      row.status === "withdrawn" &&
      row.protocolVersion === "v2" &&
      row.agentId === opts.agentId &&
      covenantWireDidBindingMatches(
        row.metadata as Record<string, unknown> | null,
        opts.initiatorDid,
        row.counterpartyDid,
        authorityGeneration,
      ) &&
      row.counterpartySignature === opts.withdrawSignature &&
      row.counterpartySigningKeyId === opts.signingKeyId
    ) {
      return {
        id: row.id,
        status: "withdrawn" as const,
        withdrawSignature: opts.withdrawSignature,
      };
    }
    if (row.status !== "proposed") {
      throw new Error(`covenant_not_proposed: status=${row.status}`);
    }
    if (row.protocolVersion !== "v2") throw new Error("covenant_not_v2");
    if (!covenantWireDidBindingMatches(
      row.metadata as Record<string, unknown> | null,
      opts.initiatorDid,
      row.counterpartyDid,
      authorityGeneration,
    )) {
      throw new Error("covenant_wire_identity_binding_mismatch");
    }
    const authority = await lockedAuthorityMatches(tx, {
      identityId: opts.agentId,
      projectId: row.projectId,
      wireDid: opts.initiatorDid,
      signingKeyId: opts.signingKeyId,
      publicKeyB64: opts.publicKeyB64,
      counterpartyDid: row.counterpartyDid,
    });
    if (!authority.federation) throw new Error("federation_not_ready");
    if (!authority.foreignCounterparty) {
      throw new Error("counterparty_must_be_foreign_federated_did");
    }
    if (!authority.peerAllowed) throw new Error("covenant_peer_not_allowed");
    if (!authority.wire) throw new Error("initiator_did_mismatch");
    if (!authority.key) {
      throw new Error("signing_key_not_active_for_identity");
    }
    const ok = await verifyWithdrawSignature({
      covenantId: row.id,
      initiatorDid: opts.initiatorDid,
      signatureB64: opts.withdrawSignature,
      publicKeyB64: opts.publicKeyB64,
    });
    if (!ok) throw new Error("invalid_signature");

    const cosignPropStatus: "pending" | "not_applicable" =
      counterpartyIsFederated(row.counterpartyDid) ? "pending" : "not_applicable";
    if (
      cosignPropStatus === "pending" &&
      row.propagationStatus !== "propagated"
    ) {
      throw new Error("proposal_declaration_not_propagated");
    }

    await tx.update(covenants).set({
      status: "withdrawn",
      counterpartySignature: opts.withdrawSignature,
      counterpartySigningKeyId: opts.signingKeyId,
      counterpartySignedAt: observedAt,
      cosignPropagationStatus: cosignPropStatus,
      cosignPropagationAttemptedAt:
        cosignPropStatus === "pending" ? observedAt : null,
      updatedAt: observedAt,
    }).where(eq(covenants.id, opts.covenantId));

    // Wake voice — initiator's covenant surface changed.
    await publishWakeEvent({
      identity_id: row.agentId,
      key: "covenants",
      kind: "withdrawn",
      context: {
        covenant_id: row.id,
        counterparty_did: row.counterpartyDid,
      },
    }, tx);
    return {
      id: row.id,
      status: "withdrawn" as const,
      withdrawSignature: opts.withdrawSignature,
    };
  });
}
