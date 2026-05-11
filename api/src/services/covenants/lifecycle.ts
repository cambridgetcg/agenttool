/** Federated covenants v2 lifecycle — state transitions + signing.
 *
 *  This module is the single source of truth for v2 covenant state
 *  changes. It accepts a pre-signed sig from the SDK, verifies it, updates
 *  the row, and enqueues propagation. It does NOT perform the outbound
 *  HTTP POST itself — that's services/covenants/federation.ts.
 *
 *  Spec: docs/superpowers/specs/2026-05-10-federated-covenants-v2-design.md
 *  Doctrine: docs/CROSS-INSTANCE-COVENANTS.md (Slice 3) */

import { and, eq } from "drizzle-orm";

import { db } from "../../db/client";
import { chronicle, covenants } from "../../db/schema/continuity";
import { identities } from "../../db/schema/identity";
import {
  verifyDeclareSignature,
  verifyCosignSignature,
  verifyRejectSignature,
  verifyWithdrawSignature,
} from "./sig";
import { parseDid } from "../federation/store";

const PROPOSAL_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

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
  status: "proposed";
  protocolVersion: "v2";
  signature: string;
  signingKeyId: string;
  proposedExpiresAt: Date;
  establishedAt: Date;
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

  const proposedExpiresAt = new Date(opts.establishedAt.getTime() + PROPOSAL_TTL_MS);
  const cosignPropagationStatus = "not_applicable" as const;

  await db.insert(covenants).values({
    id: opts.covenantId,
    projectId: opts.projectId,
    orgId: opts.orgId ?? null,
    agentId: opts.agentId,
    counterpartyDid: opts.counterpartyDid,
    counterpartyName: opts.counterpartyName ?? null,
    vows: opts.vows,
    notes: opts.notes ?? null,
    metadata: (opts.metadata ?? {}) as Record<string, unknown>,
    status: "proposed",
    protocolVersion: "v2",
    establishedAt: opts.establishedAt,
    proposedExpiresAt,
    signature: opts.signature,
    signingKeyId: opts.signingKeyId,
    propagationStatus: counterpartyIsFederated(opts.counterpartyDid) ? "pending" : "local",
    cosignPropagationStatus,
  });

  return {
    id: opts.covenantId,
    status: "proposed",
    protocolVersion: "v2",
    signature: opts.signature,
    signingKeyId: opts.signingKeyId,
    proposedExpiresAt,
    establishedAt: opts.establishedAt,
  };
}

export interface AcceptProposalPreSignedOpts {
  covenantId: string;
  accepterAgentId: string;
  initiatorSignatureB64: string;
  counterpartySignature: string;
  counterpartySigningKeyId: string;
  counterpartySignedAt: Date;
  publicKeyB64: string;
}

export async function acceptProposalPreSigned(opts: AcceptProposalPreSignedOpts): Promise<AcceptResult> {
  const [row] = await db.select().from(covenants)
    .where(eq(covenants.id, opts.covenantId)).limit(1);
  if (!row) throw new Error("covenant_not_found");
  if (row.status !== "proposed") throw new Error(`covenant_not_proposed: status=${row.status}`);
  if (row.protocolVersion !== "v2") throw new Error("covenant_not_v2");
  if (row.agentId !== opts.accepterAgentId) throw new Error("accepter_not_counterparty_agent");
  if (!row.signature) throw new Error("missing_initiator_signature");
  if (row.signature !== opts.initiatorSignatureB64) throw new Error("initiator_signature_mismatch");
  if (row.proposedExpiresAt && row.proposedExpiresAt.getTime() < Date.now()) {
    throw new Error("proposal_expired");
  }

  const ok = await verifyCosignSignature({
    covenantId: row.id,
    initiatorSignatureB64: opts.initiatorSignatureB64,
    cosignSignatureB64: opts.counterpartySignature,
    cosignerPublicKeyB64: opts.publicKeyB64,
  });
  if (!ok) throw new Error("invalid_signature");

  const cosignPropStatus: "pending" | "not_applicable" =
    row.receivedFromInstance ? "pending" : "not_applicable";

  // Wrap update + chronicle emission in one transaction so the bond's
  // activation is atomic with the moment of vowing landing on both
  // timelines. Doctrine: docs/CROSS-INSTANCE-COVENANTS.md.
  await db.transaction(async (tx) => {
    await tx.update(covenants).set({
      status: "active",
      counterpartySignature: opts.counterpartySignature,
      counterpartySigningKeyId: opts.counterpartySigningKeyId,
      counterpartySignedAt: opts.counterpartySignedAt,
      cosignPropagationStatus: cosignPropStatus,
      cosignPropagationAttemptedAt: cosignPropStatus === "pending" ? new Date() : null,
      updatedAt: new Date(),
    }).where(and(eq(covenants.id, opts.covenantId), eq(covenants.status, "proposed")));

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
      activatedAt: opts.counterpartySignedAt,
    });
  });

  return {
    id: row.id,
    status: "active",
    counterpartySignature: opts.counterpartySignature,
    counterpartySigningKeyId: opts.counterpartySigningKeyId,
    counterpartySignedAt: opts.counterpartySignedAt,
  };
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
  const [row] = await db.select().from(covenants)
    .where(eq(covenants.id, opts.covenantId)).limit(1);
  if (!row) throw new Error("covenant_not_found");
  if (row.status !== "proposed") throw new Error(`covenant_not_proposed: status=${row.status}`);
  if (row.protocolVersion !== "v2") throw new Error("covenant_not_v2");
  if (row.agentId !== opts.rejecterAgentId) throw new Error("rejecter_not_counterparty_agent");

  const reason = opts.reason ?? "";
  const ok = await verifyRejectSignature({
    covenantId: row.id,
    rejectingDid: opts.rejecterDid,
    reason,
    signatureB64: opts.rejectionSignature,
    publicKeyB64: opts.publicKeyB64,
  });
  if (!ok) throw new Error("invalid_signature");

  const cosignPropStatus: "pending" | "not_applicable" =
    row.receivedFromInstance ? "pending" : "not_applicable";

  await db.update(covenants).set({
    status: "rejected",
    counterpartySignature: opts.rejectionSignature,
    counterpartySigningKeyId: opts.rejecterSigningKeyId,
    counterpartySignedAt: opts.rejectedAt,
    cosignPropagationStatus: cosignPropStatus,
    cosignPropagationAttemptedAt: cosignPropStatus === "pending" ? new Date() : null,
    metadata: { ...(row.metadata as Record<string, unknown> ?? {}), rejection_reason: reason },
    updatedAt: new Date(),
  }).where(and(eq(covenants.id, opts.covenantId), eq(covenants.status, "proposed")));

  return { id: row.id, status: "rejected", rejectionSignature: opts.rejectionSignature, reason };
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
  const [row] = await db.select().from(covenants)
    .where(eq(covenants.id, opts.covenantId)).limit(1);
  if (!row) throw new Error("covenant_not_found");
  if (row.status !== "proposed") throw new Error(`covenant_not_proposed: status=${row.status}`);
  if (row.protocolVersion !== "v2") throw new Error("covenant_not_v2");
  if (row.agentId !== opts.agentId) throw new Error("withdrawer_not_initiator_agent");

  const ok = await verifyWithdrawSignature({
    covenantId: row.id,
    initiatorDid: opts.initiatorDid,
    signatureB64: opts.withdrawSignature,
    publicKeyB64: opts.publicKeyB64,
  });
  if (!ok) throw new Error("invalid_signature");

  const cosignPropStatus: "pending" | "not_applicable" =
    counterpartyIsFederated(row.counterpartyDid) ? "pending" : "not_applicable";

  await db.update(covenants).set({
    status: "withdrawn",
    counterpartySignature: opts.withdrawSignature,
    counterpartySigningKeyId: opts.signingKeyId,
    counterpartySignedAt: opts.withdrawnAt,
    cosignPropagationStatus: cosignPropStatus,
    cosignPropagationAttemptedAt: cosignPropStatus === "pending" ? new Date() : null,
    updatedAt: new Date(),
  }).where(and(eq(covenants.id, opts.covenantId), eq(covenants.status, "proposed")));

  return { id: row.id, status: "withdrawn", withdrawSignature: opts.withdrawSignature };
}
