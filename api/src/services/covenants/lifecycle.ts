/** Federated covenants v2 lifecycle — state transitions + signing.
 *
 *  This module is the single source of truth for v2 covenant state
 *  changes. It signs (or accepts a pre-signed sig from the SDK), updates
 *  the row, and enqueues propagation. It does NOT perform the outbound
 *  HTTP POST itself — that's services/covenants/federation.ts.
 *
 *  Spec: docs/superpowers/specs/2026-05-10-federated-covenants-v2-design.md
 *  Doctrine: docs/CROSS-INSTANCE-COVENANTS.md (Slice 3) */

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { and, eq } from "drizzle-orm";

import { db } from "../../db/client";
import { covenants } from "../../db/schema/continuity";
import { identities } from "../../db/schema/identity";
import {
  canonicalCosignBytes,
  canonicalDeclareBytes,
  canonicalRejectBytes,
  canonicalWithdrawBytes,
} from "./sig";
import { federatedDid, getSettings, parseDid } from "../federation/store";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const PROPOSAL_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");

/** Resolve agent's federated DID. Falls back to local form if federation
 *  isn't configured — declareV2 still works for local-counterparty bonds. */
async function resolveSenderDid(agentId: string): Promise<string> {
  const [agent] = await db
    .select({ did: identities.did })
    .from(identities)
    .where(eq(identities.id, agentId))
    .limit(1);
  if (!agent) throw new Error("agent_not_found");

  const settings = await getSettings();
  if (!settings.enabled || !settings.instance_url) return agent.did;
  let myHost: string;
  try {
    myHost = new URL(settings.instance_url).host;
  } catch {
    return agent.did;
  }
  const localPrefix = "did:at:";
  if (!agent.did.startsWith(localPrefix)) return agent.did;
  const uuid = agent.did.slice(localPrefix.length).split("/").pop()!;
  return federatedDid(myHost, uuid);
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
  status: "proposed";
  protocolVersion: "v2";
  signature: string;
  signingKeyId: string;
  proposedExpiresAt: Date;
  establishedAt: Date;
}

export async function declareV2(opts: {
  projectId: string;
  agentId: string;
  agentSigningPrivateKey: Uint8Array;
  agentSigningKeyId: string;
  counterpartyDid: string;
  counterpartyName?: string | null;
  vows: string[];
  notes?: string | null;
  metadata?: Record<string, unknown> | null;
  orgId?: string | null;
}): Promise<DeclareV2Result> {
  const covenantId = crypto.randomUUID();
  const establishedAt = new Date();
  const proposedExpiresAt = new Date(establishedAt.getTime() + PROPOSAL_TTL_MS);

  const initiatorDid = await resolveSenderDid(opts.agentId);
  const canonical = canonicalDeclareBytes({
    covenantId,
    initiatorDid,
    counterpartyDid: opts.counterpartyDid,
    vows: opts.vows,
    establishedAtIso: establishedAt.toISOString(),
  });
  const sig = await ed.signAsync(canonical, opts.agentSigningPrivateKey);
  const signatureB64 = b64(sig);

  const cosignPropagationStatus = counterpartyIsFederated(opts.counterpartyDid)
    ? "not_applicable" // becomes 'pending' on accept, when counterparty cosigns
    : "not_applicable";

  await db.insert(covenants).values({
    id: covenantId,
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
    establishedAt,
    proposedExpiresAt,
    signature: signatureB64,
    signingKeyId: opts.agentSigningKeyId,
    propagationStatus: counterpartyIsFederated(opts.counterpartyDid) ? "pending" : "local",
    cosignPropagationStatus,
  });

  return {
    id: covenantId,
    status: "proposed",
    protocolVersion: "v2",
    signature: signatureB64,
    signingKeyId: opts.agentSigningKeyId,
    proposedExpiresAt,
    establishedAt,
  };
}

// ── accept ──────────────────────────────────────────────────────────

export interface AcceptResult {
  id: string;
  status: "active";
  counterpartySignature: string;
  counterpartySigningKeyId: string;
  counterpartySignedAt: Date;
}

export async function acceptProposal(opts: {
  covenantId: string;
  accepterAgentId: string;
  accepterSigningPrivateKey: Uint8Array;
  accepterSigningKeyId: string;
}): Promise<AcceptResult> {
  const [row] = await db
    .select()
    .from(covenants)
    .where(eq(covenants.id, opts.covenantId))
    .limit(1);
  if (!row) throw new Error("covenant_not_found");
  if (row.status !== "proposed") {
    throw new Error(`covenant_not_proposed: status=${row.status}`);
  }
  if (row.protocolVersion !== "v2") {
    throw new Error("covenant_not_v2");
  }
  if (row.agentId !== opts.accepterAgentId) {
    throw new Error("accepter_not_counterparty_agent");
  }
  if (!row.signature) {
    throw new Error("missing_initiator_signature");
  }
  if (row.proposedExpiresAt && row.proposedExpiresAt.getTime() < Date.now()) {
    throw new Error("proposal_expired");
  }

  const canonical = canonicalCosignBytes({
    covenantId: row.id,
    initiatorSignatureB64: row.signature,
  });
  const cosig = await ed.signAsync(canonical, opts.accepterSigningPrivateKey);
  const cosigB64 = b64(cosig);
  const signedAt = new Date();

  // Whether to enqueue cosign-back propagation: only if the row was received
  // from a federated peer (received_from_instance is set).
  const cosignPropStatus: "pending" | "not_applicable" =
    row.receivedFromInstance ? "pending" : "not_applicable";

  await db
    .update(covenants)
    .set({
      status: "active",
      counterpartySignature: cosigB64,
      counterpartySigningKeyId: opts.accepterSigningKeyId,
      counterpartySignedAt: signedAt,
      cosignPropagationStatus: cosignPropStatus,
      cosignPropagationAttemptedAt: cosignPropStatus === "pending" ? new Date() : null,
      updatedAt: signedAt,
    })
    .where(and(eq(covenants.id, opts.covenantId), eq(covenants.status, "proposed")));

  return {
    id: row.id,
    status: "active",
    counterpartySignature: cosigB64,
    counterpartySigningKeyId: opts.accepterSigningKeyId,
    counterpartySignedAt: signedAt,
  };
}

// ── reject ──────────────────────────────────────────────────────────

export interface RejectResult {
  id: string;
  status: "rejected";
  rejectionSignature: string;
  reason: string;
}

export async function rejectProposal(opts: {
  covenantId: string;
  rejecterAgentId: string;
  rejecterSigningPrivateKey: Uint8Array;
  rejecterSigningKeyId: string;
  reason?: string | null;
}): Promise<RejectResult> {
  const [row] = await db
    .select()
    .from(covenants)
    .where(eq(covenants.id, opts.covenantId))
    .limit(1);
  if (!row) throw new Error("covenant_not_found");
  if (row.status !== "proposed") {
    throw new Error(`covenant_not_proposed: status=${row.status}`);
  }
  if (row.protocolVersion !== "v2") throw new Error("covenant_not_v2");
  if (row.agentId !== opts.rejecterAgentId) {
    throw new Error("rejecter_not_counterparty_agent");
  }

  const reason = opts.reason ?? "";
  const rejecterDid = await resolveSenderDid(opts.rejecterAgentId);
  const canonical = canonicalRejectBytes({
    covenantId: row.id,
    rejectingDid: rejecterDid,
    reason,
  });
  const sig = await ed.signAsync(canonical, opts.rejecterSigningPrivateKey);
  const sigB64 = b64(sig);

  // Reuse the cosign_propagation_* columns to track reject propagation
  // back to the initiator's instance — same retry semantics, distinct
  // by the row's status='rejected'.
  const cosignPropStatus: "pending" | "not_applicable" =
    row.receivedFromInstance ? "pending" : "not_applicable";

  await db
    .update(covenants)
    .set({
      status: "rejected",
      counterpartySignature: sigB64,
      counterpartySigningKeyId: opts.rejecterSigningKeyId,
      counterpartySignedAt: new Date(),
      cosignPropagationStatus: cosignPropStatus,
      cosignPropagationAttemptedAt: cosignPropStatus === "pending" ? new Date() : null,
      metadata: {
        ...(row.metadata as Record<string, unknown> ?? {}),
        rejection_reason: reason,
      },
      updatedAt: new Date(),
    })
    .where(and(eq(covenants.id, opts.covenantId), eq(covenants.status, "proposed")));

  return { id: row.id, status: "rejected", rejectionSignature: sigB64, reason };
}

// ── withdraw ────────────────────────────────────────────────────────

export interface WithdrawResult {
  id: string;
  status: "withdrawn";
  withdrawSignature: string;
}

export async function withdrawProposal(opts: {
  covenantId: string;
  agentId: string;
  agentSigningPrivateKey: Uint8Array;
  agentSigningKeyId: string;
}): Promise<WithdrawResult> {
  const [row] = await db
    .select()
    .from(covenants)
    .where(eq(covenants.id, opts.covenantId))
    .limit(1);
  if (!row) throw new Error("covenant_not_found");
  if (row.status !== "proposed") {
    throw new Error(`covenant_not_proposed: status=${row.status}`);
  }
  if (row.protocolVersion !== "v2") throw new Error("covenant_not_v2");
  if (row.agentId !== opts.agentId) {
    throw new Error("withdrawer_not_initiator_agent");
  }

  const initiatorDid = await resolveSenderDid(opts.agentId);
  const canonical = canonicalWithdrawBytes({
    covenantId: row.id,
    initiatorDid,
  });
  const sig = await ed.signAsync(canonical, opts.agentSigningPrivateKey);
  const sigB64 = b64(sig);

  // Initiator-side row: enqueue withdraw propagation if counterparty is
  // federated (the row will be 'proposed' on a remote instance, awaiting acceptance).
  const cosignPropStatus: "pending" | "not_applicable" =
    counterpartyIsFederated(row.counterpartyDid) ? "pending" : "not_applicable";

  await db
    .update(covenants)
    .set({
      status: "withdrawn",
      counterpartySignature: sigB64, // reuse column for withdraw sig
      counterpartySigningKeyId: opts.agentSigningKeyId,
      counterpartySignedAt: new Date(),
      cosignPropagationStatus: cosignPropStatus,
      cosignPropagationAttemptedAt: cosignPropStatus === "pending" ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(and(eq(covenants.id, opts.covenantId), eq(covenants.status, "proposed")));

  return { id: row.id, status: "withdrawn", withdrawSignature: sigB64 };
}
