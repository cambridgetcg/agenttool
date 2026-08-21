/** Cross-instance covenant propagation (Horizon B, Slice 2).
 *
 *  When an agent declares a covenant whose counterparty is a federated
 *  DID (`did:at:<peer-host>/<uuid>`), we POST the declaration to the
 *  peer's `/federation/covenants` endpoint so the peer's local table
 *  also has a queryable record. After propagation, both sides' inbox
 *  / voice / constitutive-elevation gates can answer "is X covenanted
 *  with Y?" against a local query — no per-call peer round-trip.
 *
 *  Fresh cross-instance declarations and lifecycle effects are v2-only.
 *  HTTPS is transport protection, not caller authentication: the receiver
 *  requires an explicit nonempty peer allowlist, exact canonical wire DIDs,
 *  active identity keys, and user-level Ed25519 signatures. Stored v1 rows
 *  remain historical/readable but cannot be created, mutated, or propagated
 *  across instances.
 *
 *  Doctrine: docs/CROSS-INSTANCE-COVENANTS.md */

import { and, eq, gte, isNull, lt, notLike, or, sql, type SQL } from "drizzle-orm";

import { db } from "../../db/client";
import { covenants } from "../../db/schema/continuity";
import { federationSettings } from "../../db/schema/federation";
import { identities, identityKeys } from "../../db/schema/identity";
import { publishWakeEvent } from "../wake/push";
import {
  getSettings,
  isCanonicalAllowedOrigins,
  isCanonicalFederationInstanceUrl,
  isCanonicalUuid,
  parseDid,
  recordOutboundPeer,
} from "../federation/store";
import { safeFederationHttpsRequest } from "../federation/safe-fetch";
import {
  deriveLocalWireDid,
  resolveLocalWireIdentity,
  type LocalWireIdentitySnapshot,
} from "./wire-identity";
import {
  COVENANT_INITIATOR_WIRE_DID_METADATA_KEY,
  COVENANT_RECIPIENT_WIRE_DID_METADATA_KEY,
  COVENANT_REJECTION_REASON_METADATA_KEY,
  COVENANT_COSIGN_ARRIVAL_GRACE_MS,
  COVENANT_PROPOSAL_TTL_MS,
  acquireCovenantMutationAdvisoryLock,
  covenantCallerDeclarationMetadata,
  covenantDeclarationWireFieldsAreBounded,
  covenantDeclarationWirePayloadIsBounded,
  covenantEstablishedAtIsAdmissible,
  covenantMetadataHasCurrentV2AuthorityGeneration,
  covenantMetadataHasReservedKey,
  covenantMetadataWithWireDidBinding,
  covenantV2AuthorityGeneration,
  covenantWireDidBindingMatches,
  isCanonicalEd25519Signature,
  isCanonicalCovenantId,
  isCanonicalSignedUuid,
  isCanonicalUtcMillisecondTimestamp,
  proposalAcceptsDeliveredCosignAt,
} from "./canonical";

const PROPAGATION_TIMEOUT_MS = 12_000;
export const DECLARATION_PROPAGATION_MAX_ATTEMPTS = 5;
export const COSIGN_PROPAGATION_MAX_ATTEMPTS = 5;

export interface DeclarationPropagationClaim {
  attempts: number;
  attemptedAt: Date | null;
  lastError: string | null;
}

export interface CosignPropagationClaim {
  attempts: number;
  attemptedAt: Date | null;
}

type CovenantLifecycleStatus = typeof covenants.$inferSelect.status;
type CovenantTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Declaration delivery always reconstructs the immutable proposal envelope.
 * The local row may already be active after a lost declaration ACK. */
export function federatedV2DeclarationWireStatus(
  _localLifecycleStatus: CovenantLifecycleStatus,
): "proposed" {
  return "proposed";
}

/** Legacy canonical string retained for compatibility consumers. Active v2
 * signing uses sig.ts; fresh federated v1 ingress and egress are retired. */
export function canonicalCovenantBytes(opts: {
  senderDid: string;
  counterpartyDid: string;
  vows: string[];
  status: string;
  establishedAtIso: string;
}): string {
  // Pure-string canonical form (consumers SHA-256 it). We keep this
  // in plaintext rather than returning a digest so callers in any
  // language can inspect/reproduce exactly.
  const sortedVows = JSON.stringify([...opts.vows].sort());
  return [
    "federated-covenant/v1",
    opts.senderDid,
    opts.counterpartyDid,
    sortedVows,
    opts.status,
    opts.establishedAtIso,
  ].join("\0");
}

interface PropagateResult {
  ok: boolean;
  status_code?: number;
  peer_response?: unknown;
  error?: string;
}

interface DeclarationPropagationEnvelope {
  projectId: string;
  orgId: string | null;
  agentId: string;
  agentDid: string;
  agentStatus: string;
  wireDid: string;
  counterpartyDid: string;
  counterpartyName: string | null;
  vows: string[];
  notes: string | null;
  metadataJson: string;
  lifecycleStatus: CovenantLifecycleStatus;
  protocolVersion: "v1" | "v2";
  establishedAt: Date;
  signature: string | null;
  signingKeyId: string | null;
  signingPublicKey: string | null;
  proposedExpiresAt: Date | null;
  settingsPresent: boolean;
  federationEnabled: boolean;
  instanceUrl: string | null;
  allowedOrigins: string[];
}

/** Best-effort, fire-and-forget propagation. Updates the covenant
 *  row's propagation_* fields. Safe to await OR `void`-call from a
 *  request handler. */
export async function propagateCovenant(
  covenantId: string,
  expectedClaim?: DeclarationPropagationClaim,
): Promise<PropagateResult> {
  const authorityGeneration = covenantV2AuthorityGeneration();
  if (!authorityGeneration) {
    return { ok: false, error: "covenant_v2_authority_not_ready" };
  }
  const [row] = await db
    .select()
    .from(covenants)
    .where(eq(covenants.id, covenantId))
    .limit(1);
  if (!row) return { ok: false, error: "covenant_not_found" };
  if (row.protocolVersion !== "v2") {
    return { ok: false, error: "federated_v1_propagation_retired" };
  }
  if (!covenantMetadataHasCurrentV2AuthorityGeneration(
    row.metadata as Record<string, unknown> | null,
    authorityGeneration,
  )) {
    return { ok: false, error: "covenant_v2_authority_generation_mismatch" };
  }

  // Already-received covenants don't propagate further (avoid loops).
  if (row.receivedFromInstance) {
    return { ok: false, error: "received_covenant_does_not_propagate" };
  }
  if (row.status !== "proposed" && row.status !== "active") {
    return await markDeclarationStateIfIdle(
      row,
      "rejected",
      "covenant_status_not_declarable",
    );
  }

  // Counterparty must be federated.
  let counterpartyParsed;
  try {
    counterpartyParsed = parseDid(row.counterpartyDid);
  } catch (e) {
    // Not a DID at all (e.g. "human:Yu") — nothing to propagate.
    return await markDeclarationStateIfIdle(row, "local", null);
  }
  if (!counterpartyParsed.host) {
    // Local DID — no propagation needed.
    return await markDeclarationStateIfIdle(row, "local", null);
  }

  // Resolve the exact local wire identity and origin snapshot before claiming
  // the delivery. The same snapshot is fenced through completion.
  const agent = await resolveLocalWireIdentity(row.agentId);
  if (!agent || agent.status !== "active") {
    return await markDeclarationStateIfIdle(
      row,
      "rejected",
      "agent_not_active_or_wire_did_unresolved",
    );
  }
  if (
    !agent.federationEnabled ||
    !agent.instanceUrl ||
    !isCanonicalFederationInstanceUrl(agent.instanceUrl) ||
    agent.allowedOrigins.length === 0 ||
    !isCanonicalAllowedOrigins(agent.allowedOrigins) ||
    !agent.allowedOrigins.includes(counterpartyParsed.host)
  ) {
    return await markDeclarationStateIfIdle(
      row,
      "pending",
      "federation_not_ready_or_peer_not_allowed",
    );
  }
  const senderDid = agent.wireDid;
  if (!covenantWireDidBindingMatches(
    row.metadata as Record<string, unknown> | null,
    senderDid,
    row.counterpartyDid,
    authorityGeneration,
  )) {
    return { ok: false, error: "covenant_wire_identity_binding_mismatch" };
  }
  const callerMetadata = covenantCallerDeclarationMetadata(
    row.metadata as Record<string, unknown> | null,
  );
  if (!covenantDeclarationWireFieldsAreBounded({
    agentDid: senderDid,
    counterpartyDid: row.counterpartyDid,
    counterpartyName: row.counterpartyName,
    vows: row.vows,
    notes: row.notes,
    metadata: callerMetadata,
  })) {
    return await markDeclarationStateIfIdle(
      row,
      "rejected",
      "covenant_declaration_out_of_bounds",
    );
  }
  let signingPublicKey: string | null = null;
  if (row.protocolVersion === "v2" && (!row.signature || !row.signingKeyId)) {
    return await markDeclarationStateIfIdle(
      row,
      "rejected",
      "v2_declaration_envelope_incomplete",
    );
  }
  if (row.protocolVersion === "v2") {
    const [signingKey] = await db
      .select({ publicKey: identityKeys.publicKey })
      .from(identityKeys)
      .where(and(
        eq(identityKeys.id, row.signingKeyId!),
        eq(identityKeys.identityId, row.agentId),
        eq(identityKeys.active, true),
        isNull(identityKeys.revokedAt),
      ))
      .limit(1);
    if (!signingKey) {
      return await markDeclarationStateIfIdle(
        row,
        "rejected",
        "declaration_signing_key_not_active",
      );
    }
    signingPublicKey = signingKey.publicKey;
    const { verifyDeclareSignature } = await import("./sig");
    const signatureMatchesCurrentEnvelope = await verifyDeclareSignature({
      covenantId: row.id,
      initiatorDid: senderDid,
      counterpartyDid: row.counterpartyDid,
      vows: row.vows,
      establishedAtIso: row.establishedAt.toISOString(),
      signatureB64: row.signature!,
      publicKeyB64: signingKey.publicKey,
    });
    if (!signatureMatchesCurrentEnvelope) {
      return await markDeclarationStateIfIdle(
        row,
        "rejected",
        "declaration_signature_not_bound_to_current_wire_identity",
      );
    }
  }

  const url = `https://${counterpartyParsed.host}/federation/covenants`;
  const payload = {
    covenant_id: row.id,
    protocol_version: "v2" as const,
    sender_did: senderDid,
    counterparty_did: row.counterpartyDid,
    vows: row.vows,
    status: federatedV2DeclarationWireStatus(row.status),
    counterparty_name: row.counterpartyName,
    notes: row.notes,
    metadata: callerMetadata,
    established_at: row.establishedAt.toISOString(),
    signing_key_id: row.signingKeyId,
    signature: row.signature,
    proposed_expires_at: row.proposedExpiresAt?.toISOString() ?? null,
  };
  if (!covenantDeclarationWirePayloadIsBounded(payload)) {
    return await markDeclarationStateIfIdle(
      row,
      "rejected",
      "covenant_declaration_out_of_bounds",
    );
  }

  const envelope = declarationEnvelope(row, agent, signingPublicKey);
  const claimToken = `in_flight_declare:${crypto.randomUUID()}`;
  const claimed = await claimDeclarationPropagationAttempt(
    covenantId,
    expectedClaim ?? {
      attempts: row.propagationAttempts,
      attemptedAt: row.propagationAttemptedAt,
      lastError: row.propagationLastError,
    },
    claimToken,
    envelope,
  );
  if (!claimed) {
    return { ok: false, error: "declaration_propagation_attempt_not_claimed" };
  }

  let res;
  try {
    res = await safeFederationHttpsRequest(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      timeoutMs: PROPAGATION_TIMEOUT_MS,
    });
  } catch (err) {
    const msg = (err as Error).message;
    const finished = await finishDeclarationPropagationAttempt(
      covenantId,
      claimToken,
      envelope,
      "pending",
      `network_error: ${msg}`,
    );
    if (!finished) {
      return { ok: false, error: "declaration_completion_fence_lost" };
    }
    return { ok: false, error: `network_error: ${msg}` };
  }

  const responseBody = res.body.toString("utf8");
  if (res.statusCode >= 400 && res.statusCode < 500) {
    const finished = await finishDeclarationPropagationAttempt(
      covenantId,
      claimToken,
      envelope,
      "rejected",
      `peer_${res.statusCode}: ${responseBody.slice(0, 300)}`,
    );
    if (!finished) {
      return { ok: false, error: "declaration_completion_fence_lost" };
    }
    return {
      ok: false,
      status_code: res.statusCode,
      error: responseBody,
    };
  }
  if (res.statusCode !== 200 && res.statusCode !== 201) {
    const finished = await finishDeclarationPropagationAttempt(
      covenantId,
      claimToken,
      envelope,
      "pending",
      `unexpected_peer_status_${res.statusCode}: ${responseBody.slice(0, 300)}`,
    );
    if (!finished) {
      return { ok: false, error: "declaration_completion_fence_lost" };
    }
    return {
      ok: false,
      status_code: res.statusCode,
      error: responseBody,
    };
  }

  let peerResp: unknown;
  try {
    peerResp = JSON.parse(responseBody);
  } catch {
    peerResp = null;
  }
  const exactAcknowledgement = Boolean(
    peerResp &&
      typeof peerResp === "object" &&
      (peerResp as Record<string, unknown>).covenant_id === covenantId &&
      (peerResp as Record<string, unknown>).received === true,
  );
  if (!exactAcknowledgement) {
    const finished = await finishDeclarationPropagationAttempt(
      covenantId,
      claimToken,
      envelope,
      "pending",
      `invalid_peer_acknowledgement: ${responseBody.slice(0, 300)}`,
    );
    if (!finished) {
      return { ok: false, error: "declaration_completion_fence_lost" };
    }
    return {
      ok: false,
      status_code: res.statusCode,
      error: "invalid_peer_acknowledgement",
    };
  }

  const finished = await finishDeclarationPropagationAttempt(
    covenantId,
    claimToken,
    envelope,
    "propagated",
    null,
  );
  if (!finished) {
    return { ok: false, error: "declaration_completion_fence_lost" };
  }
  try {
    await recordOutboundPeer(counterpartyParsed.host);
  } catch (error) {
    console.warn("[covenant.propagate] peer audit update failed", error);
  }
  return { ok: true, status_code: res.statusCode, peer_response: peerResp };
}

async function markDeclarationStateIfIdle(
  row: typeof covenants.$inferSelect,
  status: "local" | "pending" | "propagated" | "rejected",
  error: string | null,
): Promise<PropagateResult> {
  const marked = await db
    .update(covenants)
    .set({
      propagationStatus: status,
      propagationLastError: error,
      propagationAttemptedAt: new Date(),
    })
    .where(and(
      eq(covenants.id, row.id),
      ...covenantSnapshotPredicates(row),
      or(
        isNull(covenants.propagationLastError),
        notLike(covenants.propagationLastError, "in_flight_%"),
      ),
    ))
    .returning({ id: covenants.id });
  if (marked.length !== 1) {
    return { ok: false, error: "declaration_propagation_attempt_in_flight" };
  }
  return { ok: status === "propagated", error: error ?? undefined };
}

function covenantSnapshotPredicates(
  row: typeof covenants.$inferSelect,
): SQL[] {
  return [
    eq(covenants.projectId, row.projectId),
    sql`${covenants.orgId} IS NOT DISTINCT FROM ${row.orgId}`,
    eq(covenants.agentId, row.agentId),
    eq(covenants.counterpartyDid, row.counterpartyDid),
    sql`${covenants.counterpartyName} IS NOT DISTINCT FROM ${row.counterpartyName}`,
    eq(covenants.vows, row.vows),
    sql`${covenants.notes} IS NOT DISTINCT FROM ${row.notes}`,
    sql`${covenants.metadata} = ${JSON.stringify(row.metadata ?? {})}::jsonb`,
    eq(covenants.status, row.status),
    eq(covenants.protocolVersion, row.protocolVersion),
    eq(covenants.establishedAt, row.establishedAt),
    row.proposedExpiresAt === null
      ? isNull(covenants.proposedExpiresAt)
      : eq(covenants.proposedExpiresAt, row.proposedExpiresAt),
    sql`${covenants.signature} IS NOT DISTINCT FROM ${row.signature}`,
    sql`${covenants.signingKeyId} IS NOT DISTINCT FROM ${row.signingKeyId}::uuid`,
    sql`${covenants.receivedFromInstance} IS NOT DISTINCT FROM ${row.receivedFromInstance}`,
    sql`${covenants.counterpartySignature} IS NOT DISTINCT FROM ${row.counterpartySignature}`,
    sql`${covenants.counterpartySigningKeyId} IS NOT DISTINCT FROM ${row.counterpartySigningKeyId}::uuid`,
    sql`${covenants.counterpartySignedAt} IS NOT DISTINCT FROM ${row.counterpartySignedAt}`,
  ];
}

function declarationEnvelope(
  row: typeof covenants.$inferSelect,
  agent: LocalWireIdentitySnapshot,
  signingPublicKey: string | null,
): DeclarationPropagationEnvelope {
  return {
    projectId: row.projectId,
    orgId: row.orgId,
    agentId: row.agentId,
    agentDid: agent.storedDid,
    agentStatus: agent.status,
    wireDid: agent.wireDid,
    counterpartyDid: row.counterpartyDid,
    counterpartyName: row.counterpartyName,
    vows: row.vows,
    notes: row.notes,
    metadataJson: JSON.stringify(row.metadata ?? {}),
    lifecycleStatus: row.status,
    protocolVersion: row.protocolVersion,
    establishedAt: row.establishedAt,
    signature: row.signature,
    signingKeyId: row.signingKeyId,
    signingPublicKey,
    proposedExpiresAt: row.proposedExpiresAt,
    settingsPresent: agent.settingsPresent,
    federationEnabled: agent.federationEnabled,
    instanceUrl: agent.instanceUrl,
    allowedOrigins: agent.allowedOrigins,
  };
}

function declarationEnvelopePredicates(
  expected: DeclarationPropagationEnvelope,
): SQL[] {
  const settingsPredicate = expected.settingsPresent
    ? sql`EXISTS (
        SELECT 1 FROM federation.settings AS settings
        WHERE settings.id = 1
          AND settings.enabled = ${expected.federationEnabled}
          AND settings.instance_url IS NOT DISTINCT FROM ${expected.instanceUrl}
          AND to_jsonb(settings.allowed_origins) = ${JSON.stringify(expected.allowedOrigins)}::jsonb
      )`
    : sql`NOT EXISTS (SELECT 1 FROM federation.settings)`;
  const keyPredicate = expected.protocolVersion === "v2"
    ? sql`EXISTS (
        SELECT 1 FROM identity.identity_keys AS signing_key
        WHERE signing_key.id = ${expected.signingKeyId}::uuid
          AND signing_key.identity_id = ${expected.agentId}::uuid
          AND signing_key.public_key = ${expected.signingPublicKey}
          AND signing_key.active = true
          AND signing_key.revoked_at IS NULL
      )`
    : sql`true`;
  return [
    eq(covenants.projectId, expected.projectId),
    sql`${covenants.orgId} IS NOT DISTINCT FROM ${expected.orgId}`,
    eq(covenants.agentId, expected.agentId),
    isNull(covenants.receivedFromInstance),
    eq(covenants.counterpartyDid, expected.counterpartyDid),
    sql`${covenants.counterpartyName} IS NOT DISTINCT FROM ${expected.counterpartyName}`,
    eq(covenants.vows, expected.vows),
    sql`${covenants.notes} IS NOT DISTINCT FROM ${expected.notes}`,
    sql`${covenants.metadata} = ${expected.metadataJson}::jsonb`,
    eq(covenants.status, expected.lifecycleStatus),
    eq(covenants.protocolVersion, expected.protocolVersion),
    eq(covenants.establishedAt, expected.establishedAt),
    sql`${covenants.signature} IS NOT DISTINCT FROM ${expected.signature}`,
    sql`${covenants.signingKeyId} IS NOT DISTINCT FROM ${expected.signingKeyId}::uuid`,
    sql`${covenants.proposedExpiresAt} IS NOT DISTINCT FROM ${expected.proposedExpiresAt}`,
    sql`EXISTS (
      SELECT 1 FROM identity.identities AS identity_row
      WHERE identity_row.id = ${expected.agentId}::uuid
        AND identity_row.project_id = ${expected.projectId}::uuid
        AND identity_row.did = ${expected.agentDid}
        AND identity_row.status = ${expected.agentStatus}
    )`,
    settingsPredicate,
    keyPredicate,
  ];
}

async function claimDeclarationPropagationAttempt(
  covenantId: string,
  expected: DeclarationPropagationClaim,
  claimToken: string,
  envelope: DeclarationPropagationEnvelope,
): Promise<boolean> {
  const attemptedAtMatches = expected.attemptedAt === null
    ? isNull(covenants.propagationAttemptedAt)
    : eq(covenants.propagationAttemptedAt, expected.attemptedAt);
  const lastErrorMatches = expected.lastError === null
    ? isNull(covenants.propagationLastError)
    : eq(covenants.propagationLastError, expected.lastError);
  const claimed = await db
    .update(covenants)
    .set({
      propagationStatus: "pending",
      propagationLastError: claimToken,
      propagationAttemptedAt: new Date(),
      propagationAttempts: sql`${covenants.propagationAttempts} + 1`,
    })
    .where(and(
      eq(covenants.id, covenantId),
      ...declarationEnvelopePredicates(envelope),
      eq(covenants.propagationStatus, "pending"),
      eq(covenants.propagationAttempts, expected.attempts),
      lt(covenants.propagationAttempts, DECLARATION_PROPAGATION_MAX_ATTEMPTS),
      attemptedAtMatches,
      lastErrorMatches,
    ))
    .returning({ id: covenants.id });
  return claimed.length === 1;
}

async function finishDeclarationPropagationAttempt(
  covenantId: string,
  claimToken: string,
  envelope: DeclarationPropagationEnvelope,
  status: "pending" | "propagated" | "rejected",
  error: string | null,
): Promise<boolean> {
  const finished = await db
    .update(covenants)
    .set({
      propagationStatus: status,
      propagationLastError: error,
      propagationAttemptedAt: new Date(),
    })
    .where(and(
      eq(covenants.id, covenantId),
      eq(covenants.propagationLastError, claimToken),
      ...declarationEnvelopePredicates(envelope),
    ))
    .returning({ id: covenants.id });
  return finished.length === 1;
}

// ── Receive side ─────────────────────────────────────────────────────

interface ReceiveInput {
  covenant_id: string;
  protocol_version?: "v1" | "v2";
  sender_did: string;        // federated form
  counterparty_did: string;  // must resolve local OR federated-pointing-at-us
  vows: string[];
  status: "active" | "paused" | "dissolved" | "proposed";
  counterparty_name?: string | null;
  notes?: string | null;
  metadata?: Record<string, unknown> | null;
  established_at: string;    // ISO8601
  signing_key_id?: string | null;
  signature?: string | null;
  proposed_expires_at?: string | null;
}

interface ReceiveResult {
  ok: boolean;
  status_code: number;
  body: Record<string, unknown>;
}

/** Receive a propagated covenant from a peer. Verifies:
 *    - only signed v2 declarations reach any identity/settings/database work
 *    - sender_did is federated (has host)
 *    - sender host is allowed
 *    - counterparty_did resolves to a LOCAL identity
 *    - covenant_id is fresh OR is an exact immutable v2 replay
 *    - sender DID exists at the claimed peer (via /federation/identities)
 *
 *  Inserts/updates a row with `received_from_instance` populated.
 *  Returns the row id + any peer-visible note. */
export async function receiveFederatedCovenant(
  input: ReceiveInput,
): Promise<ReceiveResult> {
  const observedAt = new Date();

  if (!isCanonicalCovenantId(input.covenant_id)) {
    return badRequest("invalid_covenant_id");
  }
  if (!isCanonicalUtcMillisecondTimestamp(input.established_at)) {
    return badRequest("noncanonical_established_at");
  }
  if (!covenantDeclarationWirePayloadIsBounded({
    covenant_id: input.covenant_id,
    protocol_version: input.protocol_version ?? "v1",
    sender_did: input.sender_did,
    counterparty_did: input.counterparty_did,
    vows: input.vows,
    status: input.status,
    counterparty_name: input.counterparty_name ?? null,
    notes: input.notes ?? null,
    metadata: input.metadata ?? {},
    established_at: input.established_at,
    signing_key_id: input.signing_key_id ?? null,
    signature: input.signature ?? null,
    proposed_expires_at: input.proposed_expires_at ?? null,
  })) {
    return badRequest("covenant_declaration_out_of_bounds");
  }
  if (input.protocol_version !== "v2") {
    return {
      ok: false,
      status_code: 409,
      body: { error: "v1_declaration_ingress_retired" },
    };
  }
  if (covenantMetadataHasReservedKey(input.metadata)) {
    return badRequest("reserved_covenant_metadata_key");
  }
  const authorityGeneration = covenantV2AuthorityGeneration();
  if (!authorityGeneration) return covenantV2AuthorityNotReady();

  // 1. Sender must be federated.
  let senderParsed;
  try {
    senderParsed = parseDid(input.sender_did);
  } catch (e) {
    return badRequest("invalid_sender_did", (e as Error).message);
  }
  if (!senderParsed.host) {
    return badRequest("sender_must_be_federated");
  }
  const senderHost = senderParsed.host;
  if (input.status !== "proposed") {
    return badRequest("v2_declaration_must_be_proposed");
  }
  if (
    !input.signature ||
    !isCanonicalEd25519Signature(input.signature) ||
    !input.signing_key_id ||
    !isCanonicalSignedUuid(input.signing_key_id)
  ) {
    return badRequest("v2_requires_canonical_signature");
  }
  if (
    !input.proposed_expires_at ||
    !isCanonicalUtcMillisecondTimestamp(input.proposed_expires_at)
  ) {
    return badRequest("unsigned_proposal_expiry_mismatch");
  }
  const establishedAt = new Date(input.established_at);
  const suppliedExpiry = new Date(input.proposed_expires_at);
  const derivedV2ExpiresAt = new Date(
    establishedAt.getTime() + COVENANT_PROPOSAL_TTL_MS,
  );
  if (
    !Number.isFinite(derivedV2ExpiresAt.getTime()) ||
    suppliedExpiry.getTime() !== derivedV2ExpiresAt.getTime()
  ) {
    return badRequest("unsigned_proposal_expiry_mismatch");
  }
  const settings = await getSettings();
  if (
    !settings.enabled ||
    !settings.instance_url ||
    !isCanonicalFederationInstanceUrl(settings.instance_url)
  ) {
    return forbidden("sender_origin_not_allowed");
  }
  const localHost = new URL(settings.instance_url).hostname;
  if (senderHost === localHost) {
    return forbidden("sender_must_be_foreign");
  }
  if (settings.allowed_origins.length === 0) {
    return forbidden("covenant_origin_allowlist_required");
  }
  if (!isCanonicalAllowedOrigins(settings.allowed_origins)) {
    return forbidden("covenant_origin_allowlist_invalid");
  }
  if (!settings.allowed_origins.includes(senderHost)) {
    return forbidden("sender_origin_not_allowed");
  }

  // 2. Counterparty must resolve to a local identity.
  let counterpartyParsed;
  try {
    counterpartyParsed = parseDid(input.counterparty_did);
  } catch (e) {
    return badRequest("invalid_counterparty_did", (e as Error).message);
  }

  // Signed v2 delivery names the exact slash-qualified local wire identity.
  if (counterpartyParsed.host !== localHost) {
    return badRequest("counterparty_not_on_this_instance");
  }

  // A durable exact declaration replay is evidence of the past successful
  // write. A lost ACK remains recoverable after sender-key revocation or peer
  // resolution outage; current federation enable/origin and local wire-host
  // gates above still bound whether this endpoint answers at all.
  const [durableReplay] = await db
    .select()
    .from(covenants)
    .where(eq(covenants.id, input.covenant_id))
    .limit(1);
  if (durableReplay) {
    if (durableReplay.agentId !== counterpartyParsed.uuid) {
      return forbidden("covenant_id_collision");
    }
    return await handleExistingFederatedDeclaration({
      existing: durableReplay,
      input,
      recipientId: durableReplay.agentId,
      recipientProjectId: durableReplay.projectId,
      senderHost,
      derivedV2ExpiresAt,
      authorityGeneration,
    });
  }

  if (!covenantEstablishedAtIsAdmissible(
    new Date(input.established_at),
    observedAt,
  )) {
    return badRequest("established_at_outside_admission_window");
  }

  // 3. Look up the local identity by uuid.
  const [recipient] = await db
    .select({
      id: identities.id,
      did: identities.did,
      projectId: identities.projectId,
      status: identities.status,
    })
    .from(identities)
    .where(eq(identities.id, counterpartyParsed.uuid))
    .limit(1);
  if (!recipient || recipient.status !== "active") {
    return notFound("counterparty_not_found");
  }
  const recipientWireIdentity = await resolveLocalWireIdentity(recipient.id);
  if (
    !recipientWireIdentity ||
    recipientWireIdentity.status !== "active" ||
    recipientWireIdentity.wireDid !== input.counterparty_did
  ) {
    return badRequest("counterparty_wire_did_mismatch");
  }

  // 4. Resolve the sender at its claimed peer and obtain the exact active key
  //    needed to verify this v2 declaration.
  const { resolveFederatedDid } = await import("../federation/store");
  let senderResolved: Awaited<ReturnType<typeof resolveFederatedDid>>;
  try {
    senderResolved = await resolveFederatedDid(input.sender_did);
  } catch (e) {
    return badRequest("sender_resolve_failed", (e as Error).message);
  }

  type SigKey = { id: string; public_key: string };
  const matchingKey = (senderResolved.signing_keys as SigKey[] | undefined)
    ?.find((k) => k.id === input.signing_key_id);
  if (!matchingKey) {
    return badRequest("sender_signing_key_not_found");
  }
  const { verifyDeclareSignature } = await import("./sig");
  const ok = await verifyDeclareSignature({
    covenantId: input.covenant_id,
    initiatorDid: input.sender_did,
    counterpartyDid: input.counterparty_did,
    vows: input.vows,
    establishedAtIso: input.established_at,
    signatureB64: input.signature,
    publicKeyB64: matchingKey.public_key,
  });
  if (!ok) return forbidden("invalid_signature");

  // 5. Insert or acknowledge an exact replay. Local recipient/settings
  // authority is locked and rechecked after all remote I/O, immediately
  // before the row and wake become durable.
  // Expiry is deliberately not part of the v2 signature. Store only the
  // deterministic established_at + 30d value proven above, never the
  // unsigned wire field.
  const insertProposedExpiresAt = derivedV2ExpiresAt;

  return await db.transaction(async (tx) => {
    await acquireCovenantMutationAdvisoryLock(tx, input.covenant_id);
    // The first-insert path publishes Wake and increments this identity.
    // Acquire the identity write lock before the settings share lock as two
    // explicit statements; Promise scheduling is not a lock-order proof.
    const [currentRecipient] = await tx.select({
      id: identities.id,
      did: identities.did,
      projectId: identities.projectId,
      status: identities.status,
    }).from(identities).where(eq(identities.id, recipient.id)).for("update").limit(1);
    const [currentSettings] = await tx.select({
      enabled: federationSettings.enabled,
      instanceUrl: federationSettings.instanceUrl,
      allowedOrigins: federationSettings.allowedOrigins,
    }).from(federationSettings).where(eq(federationSettings.id, 1)).for("share").limit(1);
    const currentWireDid = currentRecipient && currentSettings
      ? deriveLocalWireDid({
          identityId: currentRecipient.id,
          storedDid: currentRecipient.did,
          federationEnabled: currentSettings.enabled,
          instanceUrl: currentSettings.instanceUrl,
        })
      : null;
    const authorityUnchanged = Boolean(
      currentRecipient &&
        currentSettings &&
        currentRecipient.id === recipient.id &&
        currentRecipient.did === recipient.did &&
        currentRecipient.projectId === recipient.projectId &&
        currentRecipient.status === "active" &&
        currentSettings.enabled &&
        currentSettings.instanceUrl !== null &&
        isCanonicalFederationInstanceUrl(currentSettings.instanceUrl) &&
        currentSettings.instanceUrl === settings.instance_url &&
        new URL(currentSettings.instanceUrl).hostname !== senderHost &&
        stableJson(currentSettings.allowedOrigins) === stableJson(settings.allowed_origins) &&
        currentSettings.allowedOrigins.length > 0 &&
        isCanonicalAllowedOrigins(currentSettings.allowedOrigins) &&
        currentSettings.allowedOrigins.includes(senderHost) &&
        currentWireDid === input.counterparty_did
    );
    if (!authorityUnchanged) {
      return {
        ok: false,
        status_code: 409,
        body: { error: "local_federation_authority_changed" },
      };
    }

    const [existing] = await tx.select().from(covenants)
      .where(eq(covenants.id, input.covenant_id)).for("update").limit(1);
    if (existing) {
      return await handleExistingFederatedDeclaration({
        existing,
        input,
        recipientId: recipient.id,
        recipientProjectId: recipient.projectId,
        senderHost,
        derivedV2ExpiresAt,
        authorityGeneration,
      });
    }

    const rows = await tx.insert(covenants).values({
      id: input.covenant_id,
      projectId: recipient.projectId,
      agentId: recipient.id,
      counterpartyDid: input.sender_did,
      counterpartyName: input.counterparty_name ?? null,
      vows: input.vows,
      notes: input.notes ?? null,
      metadata: covenantMetadataWithWireDidBinding(
        input.metadata,
        input.sender_did,
        input.counterparty_did,
        authorityGeneration,
      ),
      status: "proposed",
      protocolVersion: "v2",
      establishedAt: new Date(input.established_at),
      proposedExpiresAt: insertProposedExpiresAt,
      signature: input.signature ?? null,
      signingKeyId: input.signing_key_id ?? null,
      receivedFromInstance: senderHost,
      verifiedAt: new Date(),
      propagationStatus: "local", // received covenants don't re-propagate
    }).onConflictDoNothing({ target: covenants.id }).returning({ id: covenants.id });
    if (rows.length === 0) {
      const [winner] = await tx.select().from(covenants)
        .where(eq(covenants.id, input.covenant_id)).for("update").limit(1);
      if (!winner) return badRequest("covenant_insert_race_unresolved");
      return await handleExistingFederatedDeclaration({
        existing: winner,
        input,
        recipientId: recipient.id,
        recipientProjectId: recipient.projectId,
        senderHost,
        derivedV2ExpiresAt,
        authorityGeneration,
      });
    }

    // Wake voice is in the same transaction as the first insert. A losing
    // concurrent replay emits neither a duplicate event nor a second row.
    await publishWakeEvent({
      identity_id: recipient.id,
      key: "covenants",
      kind: "proposed",
      context: {
        covenant_id: input.covenant_id,
        counterparty_did: input.sender_did,
        role: "counterparty",
        from_instance: senderHost,
      },
    }, tx);
    return {
      ok: true,
      status_code: 201,
      body: {
        covenant_id: input.covenant_id,
        received: true,
        from_instance: senderHost,
        note: "covenant received and stored. Local gates now match this DID.",
      },
    };
  });
}

async function handleExistingFederatedDeclaration(opts: {
  existing: typeof covenants.$inferSelect;
  input: ReceiveInput;
  recipientId: string;
  recipientProjectId: string;
  senderHost: string;
  derivedV2ExpiresAt: Date;
  authorityGeneration: string;
}): Promise<ReceiveResult> {
  const {
    existing,
    input,
    recipientId,
    recipientProjectId,
    senderHost,
    derivedV2ExpiresAt,
    authorityGeneration,
  } = opts;
  // An existing locally-declared row does not prove that the remote
  // counterparty durably received this declaration. Never turn a shared-DB or
  // identifier collision into a positive delivery acknowledgement.
  if (existing.receivedFromInstance === null) {
    return {
      ok: false,
      status_code: 409,
      body: {
        error: "covenant_id_collision_local_declaration",
      },
    };
  }
  if (existing.receivedFromInstance !== senderHost) {
    return forbidden("covenant_id_collision");
  }

  const exactProposalReplay =
    existing.protocolVersion === "v2" &&
    input.status === "proposed" &&
    existing.projectId === recipientProjectId &&
    existing.orgId === null &&
    existing.agentId === recipientId &&
    existing.counterpartyDid === input.sender_did &&
    covenantWireDidBindingMatches(
      existing.metadata as Record<string, unknown> | null,
      input.sender_did,
      input.counterparty_did,
      authorityGeneration,
    ) &&
    existing.counterpartyName === (input.counterparty_name ?? null) &&
    stableJson(existing.vows) === stableJson(input.vows) &&
    existing.notes === (input.notes ?? null) &&
    stableJson(declarationMetadataForReplay(existing)) ===
      stableJson(input.metadata ?? {}) &&
    existing.signingKeyId === (input.signing_key_id ?? null) &&
    existing.signature === (input.signature ?? null) &&
    sameInstant(existing.establishedAt, input.established_at) &&
    existing.proposedExpiresAt?.getTime() === derivedV2ExpiresAt.getTime();
  if (!exactProposalReplay) {
    return {
      ok: false,
      status_code: 409,
      body: { error: "v2_declaration_replay_conflict" },
    };
  }
  return {
    ok: true,
    status_code: 200,
    body: {
      covenant_id: input.covenant_id,
      received: true,
      idempotent: true,
      note: "exact immutable v2 proposal replay",
    },
  };
}

function declarationMetadataForReplay(
  row: typeof covenants.$inferSelect,
): Record<string, unknown> {
  return covenantCallerDeclarationMetadata(
    row.metadata as Record<string, unknown> | null,
  );
}

// ── small helpers ────────────────────────────────────────────────────

function badRequest(error: string, detail?: string): ReceiveResult {
  return {
    ok: false,
    status_code: 400,
    body: detail ? { error, detail } : { error },
  };
}
function forbidden(error: string): ReceiveResult {
  return { ok: false, status_code: 403, body: { error } };
}
function notFound(error: string): ReceiveResult {
  return { ok: false, status_code: 404, body: { error } };
}

function covenantV2AuthorityNotReady(): ReceiveResult {
  return {
    ok: false,
    status_code: 409,
    body: { error: "covenant_v2_authority_not_ready" },
  };
}

function acceptedLifecycle(covenantId: string, status: string): ReceiveResult {
  return {
    ok: true,
    status_code: 200,
    body: { covenant_id: covenantId, status },
  };
}

function sameInstant(stored: Date | null, wire: string): boolean {
  const parsed = new Date(wire);
  return (
    stored !== null &&
    Number.isFinite(parsed.getTime()) &&
    stored.getTime() === parsed.getTime()
  );
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

// ── Cosign / reject / withdraw outbound (Slice 3) ────────────────────

interface CosignPayload {
  counterparty_did: string;
  counterparty_signing_key_id: string;
  counterparty_signature: string;
  counterparty_signed_at: string;
}

interface LifecyclePropagationEnvelope {
  projectId: string;
  orgId: string | null;
  lifecycleStatus: CovenantLifecycleStatus;
  protocolVersion: "v1" | "v2";
  establishedAt: Date;
  proposedExpiresAt: Date | null;
  declarationSignature: string | null;
  declarationSigningKeyId: string | null;
  signature: string;
  signingKeyId: string;
  signingPublicKey: string;
  signedAt: Date;
  agentId: string;
  agentDid: string;
  counterpartyDid: string;
  counterpartyName: string | null;
  vows: string[];
  notes: string | null;
  receivedFromInstance: string | null;
  metadataJson: string;
  settingsPresent: boolean;
  federationEnabled: boolean;
  instanceUrl: string | null;
  allowedOrigins: string[];
}

/** POST counterparty's cosign back to the initiator's instance.
 *  Marks `cosign_propagation_status` on the local row. Best-effort;
 *  the cosign-propagate worker retries pending rows. */
export async function propagateCosign(
  covenantId: string,
  expectedClaim?: CosignPropagationClaim,
): Promise<PropagateResult> {
  const authorityGeneration = covenantV2AuthorityGeneration();
  if (!authorityGeneration) {
    return { ok: false, error: "covenant_v2_authority_not_ready" };
  }
  const [row] = await db
    .select()
    .from(covenants)
    .where(eq(covenants.id, covenantId))
    .limit(1);
  if (!row) return { ok: false, error: "covenant_not_found" };
  if (row.protocolVersion !== "v2") {
    return { ok: false, error: "federated_v1_lifecycle_propagation_retired" };
  }
  if (!covenantMetadataHasCurrentV2AuthorityGeneration(
    row.metadata as Record<string, unknown> | null,
    authorityGeneration,
  )) {
    return { ok: false, error: "covenant_v2_authority_generation_mismatch" };
  }
  if (row.status !== "active") {
    return { ok: false, error: `cosign_status_not_active: ${row.status}` };
  }
  if (!row.receivedFromInstance) {
    return await markCosignProp(row, "not_applicable", null);
  }
  if (!row.counterpartySignature || !row.counterpartySigningKeyId) {
    return { ok: false, error: "missing_cosign_signature" };
  }

  if (!row.counterpartySignedAt) {
    return { ok: false, error: "missing_cosign_signed_at" };
  }
  const agent = await resolveAgentDid(row.agentId, row.counterpartySigningKeyId);
  if (
    !agent ||
    !activeFederationSnapshotAllowsPeer(agent, row.receivedFromInstance) ||
    !covenantWireDidBindingMatches(
      row.metadata as Record<string, unknown> | null,
      row.counterpartyDid,
      agent.wireDid,
      authorityGeneration,
    )
  ) {
    return { ok: false, error: "federation_disabled_or_unavailable" };
  }

  const url = `https://${row.receivedFromInstance}/federation/covenants/${row.id}/cosign`;
  const payload: CosignPayload = {
    counterparty_did: agent.wireDid,
    counterparty_signing_key_id: row.counterpartySigningKeyId,
    counterparty_signature: row.counterpartySignature,
    counterparty_signed_at: row.counterpartySignedAt.toISOString(),
  };

  return await postWithRetry(
    covenantId,
    url,
    payload,
    "cosign",
    expectedClaim ?? {
      attempts: row.cosignPropagationAttempts,
      attemptedAt: row.cosignPropagationAttemptedAt,
    },
    lifecycleEnvelope(row, agent),
  );
}

interface RejectPayload {
  rejecting_did: string;
  rejecter_signing_key_id: string;
  rejection_signature: string;
  reason: string;
  rejected_at: string;
}

export async function propagateReject(
  covenantId: string,
  expectedClaim?: CosignPropagationClaim,
): Promise<PropagateResult> {
  const authorityGeneration = covenantV2AuthorityGeneration();
  if (!authorityGeneration) {
    return { ok: false, error: "covenant_v2_authority_not_ready" };
  }
  const [row] = await db
    .select()
    .from(covenants)
    .where(eq(covenants.id, covenantId))
    .limit(1);
  if (!row) return { ok: false, error: "covenant_not_found" };
  if (row.protocolVersion !== "v2") {
    return { ok: false, error: "federated_v1_lifecycle_propagation_retired" };
  }
  if (!covenantMetadataHasCurrentV2AuthorityGeneration(
    row.metadata as Record<string, unknown> | null,
    authorityGeneration,
  )) {
    return { ok: false, error: "covenant_v2_authority_generation_mismatch" };
  }
  if (row.status !== "rejected") {
    return { ok: false, error: `reject_status_not_rejected: ${row.status}` };
  }
  if (!row.receivedFromInstance) {
    return await markCosignProp(row, "not_applicable", null);
  }
  if (!row.counterpartySignature || !row.counterpartySigningKeyId) {
    return { ok: false, error: "missing_reject_signature" };
  }

  if (!row.counterpartySignedAt) {
    return { ok: false, error: "missing_reject_signed_at" };
  }
  const agent = await resolveAgentDid(row.agentId, row.counterpartySigningKeyId);
  if (
    !agent ||
    !activeFederationSnapshotAllowsPeer(agent, row.receivedFromInstance) ||
    !covenantWireDidBindingMatches(
      row.metadata as Record<string, unknown> | null,
      row.counterpartyDid,
      agent.wireDid,
      authorityGeneration,
    )
  ) {
    return { ok: false, error: "federation_disabled_or_unavailable" };
  }

  const meta = (row.metadata as Record<string, unknown>) ?? {};
  const storedReason = meta[COVENANT_REJECTION_REASON_METADATA_KEY];
  const reason = typeof storedReason === "string" ? storedReason : "";

  const url = `https://${row.receivedFromInstance}/federation/covenants/${row.id}/reject`;
  const payload: RejectPayload = {
    rejecting_did: agent.wireDid,
    rejecter_signing_key_id: row.counterpartySigningKeyId,
    rejection_signature: row.counterpartySignature,
    reason,
    rejected_at: row.counterpartySignedAt.toISOString(),
  };
  return await postWithRetry(
    covenantId,
    url,
    payload,
    "reject",
    expectedClaim ?? {
      attempts: row.cosignPropagationAttempts,
      attemptedAt: row.cosignPropagationAttemptedAt,
    },
    lifecycleEnvelope(row, agent),
  );
}

interface WithdrawPayload {
  initiator_did: string;
  initiator_signing_key_id: string;
  withdraw_signature: string;
  withdrawn_at: string;
}

export async function propagateWithdraw(
  covenantId: string,
  expectedClaim?: CosignPropagationClaim,
): Promise<PropagateResult> {
  const authorityGeneration = covenantV2AuthorityGeneration();
  if (!authorityGeneration) {
    return { ok: false, error: "covenant_v2_authority_not_ready" };
  }
  const [row] = await db
    .select()
    .from(covenants)
    .where(eq(covenants.id, covenantId))
    .limit(1);
  if (!row) return { ok: false, error: "covenant_not_found" };
  if (row.protocolVersion !== "v2") {
    return { ok: false, error: "federated_v1_lifecycle_propagation_retired" };
  }
  if (!covenantMetadataHasCurrentV2AuthorityGeneration(
    row.metadata as Record<string, unknown> | null,
    authorityGeneration,
  )) {
    return { ok: false, error: "covenant_v2_authority_generation_mismatch" };
  }
  if (row.status !== "withdrawn") {
    return { ok: false, error: `withdraw_status_not_withdrawn: ${row.status}` };
  }
  // Withdraw is initiator-side: counterparty's instance must be derived
  // from the counterparty_did host.
  let cpHost: string | null = null;
  try {
    cpHost = parseDid(row.counterpartyDid).host;
  } catch { /* not a DID */ }
  if (!cpHost) {
    return await markCosignProp(row, "not_applicable", null);
  }
  if (!row.counterpartySignature || !row.counterpartySigningKeyId) {
    return { ok: false, error: "missing_withdraw_signature" };
  }

  // Column overloading: lifecycle.withdrawProposal stores the initiator's
  // withdraw signature in counterparty_signature/counterparty_signing_key_id
  // (see services/covenants/lifecycle.ts withdrawProposal). The wire fields
  // are renamed to initiator_* for the receiver's clarity.
  if (!row.counterpartySignedAt) {
    return { ok: false, error: "missing_withdraw_signed_at" };
  }
  const agent = await resolveAgentDid(row.agentId, row.counterpartySigningKeyId);
  if (
    !agent ||
    !activeFederationSnapshotAllowsPeer(agent, cpHost) ||
    !covenantWireDidBindingMatches(
      row.metadata as Record<string, unknown> | null,
      agent.wireDid,
      row.counterpartyDid,
      authorityGeneration,
    )
  ) {
    return { ok: false, error: "federation_disabled_or_unavailable" };
  }

  const url = `https://${cpHost}/federation/covenants/${row.id}/withdraw`;
  const payload: WithdrawPayload = {
    initiator_did: agent.wireDid,
    initiator_signing_key_id: row.counterpartySigningKeyId,
    withdraw_signature: row.counterpartySignature,
    withdrawn_at: row.counterpartySignedAt.toISOString(),
  };
  return await postWithRetry(
    covenantId,
    url,
    payload,
    "withdraw",
    expectedClaim ?? {
      attempts: row.cosignPropagationAttempts,
      attemptedAt: row.cosignPropagationAttemptedAt,
    },
    lifecycleEnvelope(row, agent),
  );
}

// ── shared post-with-retry plumbing ──────────────────────────────────

/** Resolve an agent's DID to its federated form (`did:at:<host>/<uuid>`)
 *  if federation is enabled, else return the raw local DID. Returns null
 *  on lookup failure or invalid `instance_url`.
 *
 *  Intentionally returns null rather than throwing or marking-and-returning
 *  like the inline path inside `propagateCovenant` does. Callers in the
 *  cosign/reject/withdraw paths handle nulls by calling markCosignProp,
 *  giving them a chance to choose 'rejected' (terminal) vs other states. */
type AgentDidSnapshot = LocalWireIdentitySnapshot & { signingPublicKey: string };

function activeFederationSnapshotAllowsPeer(
  snapshot: LocalWireIdentitySnapshot,
  peerHost: string,
): boolean {
  if (
    snapshot.status !== "active" ||
    !snapshot.settingsPresent ||
    !snapshot.federationEnabled ||
    snapshot.instanceUrl === null ||
    !isCanonicalFederationInstanceUrl(snapshot.instanceUrl) ||
    snapshot.allowedOrigins.length === 0 ||
    !isCanonicalAllowedOrigins(snapshot.allowedOrigins) ||
    !snapshot.allowedOrigins.includes(peerHost)
  ) return false;
  try {
    return parseDid(snapshot.wireDid).host === new URL(snapshot.instanceUrl).host;
  } catch {
    return false;
  }
}

async function resolveAgentDid(
  agentId: string,
  signingKeyId: string,
): Promise<AgentDidSnapshot | null> {
  const snapshot = await resolveLocalWireIdentity(agentId);
  if (
    snapshot?.status !== "active" ||
    !snapshot.settingsPresent ||
    !snapshot.federationEnabled ||
    !snapshot.instanceUrl
  ) {
    return null;
  }
  const [signingKey] = await db.select({ publicKey: identityKeys.publicKey })
    .from(identityKeys)
    .where(and(
      eq(identityKeys.id, signingKeyId),
      eq(identityKeys.identityId, agentId),
      eq(identityKeys.active, true),
      isNull(identityKeys.revokedAt),
    ))
    .limit(1);
  if (!signingKey) return null;
  try {
    return parseDid(snapshot.wireDid).host
      ? { ...snapshot, signingPublicKey: signingKey.publicKey }
      : null;
  } catch {
    return null;
  }
}

function lifecycleEnvelope(
  row: typeof covenants.$inferSelect,
  agent: AgentDidSnapshot,
): LifecyclePropagationEnvelope {
  if (
    !row.counterpartySignature ||
    !row.counterpartySigningKeyId ||
    !row.counterpartySignedAt
  ) {
    throw new Error("incomplete lifecycle propagation envelope");
  }
  return {
    projectId: row.projectId,
    orgId: row.orgId,
    lifecycleStatus: row.status,
    protocolVersion: row.protocolVersion,
    establishedAt: row.establishedAt,
    proposedExpiresAt: row.proposedExpiresAt,
    declarationSignature: row.signature,
    declarationSigningKeyId: row.signingKeyId,
    signature: row.counterpartySignature,
    signingKeyId: row.counterpartySigningKeyId,
    signingPublicKey: agent.signingPublicKey,
    signedAt: row.counterpartySignedAt,
    agentId: row.agentId,
    agentDid: agent.storedDid,
    counterpartyDid: row.counterpartyDid,
    counterpartyName: row.counterpartyName,
    vows: row.vows,
    notes: row.notes,
    receivedFromInstance: row.receivedFromInstance,
    metadataJson: JSON.stringify(row.metadata ?? {}),
    settingsPresent: agent.settingsPresent,
    federationEnabled: agent.federationEnabled,
    instanceUrl: agent.instanceUrl,
    allowedOrigins: agent.allowedOrigins,
  };
}

function lifecycleEnvelopePredicates(
  expected: LifecyclePropagationEnvelope,
): SQL[] {
  const settingsPredicate = expected.settingsPresent
    ? sql`EXISTS (
        SELECT 1 FROM federation.settings AS settings
        WHERE settings.id = 1
          AND settings.enabled = ${expected.federationEnabled}
          AND settings.instance_url IS NOT DISTINCT FROM ${expected.instanceUrl}
          AND to_jsonb(settings.allowed_origins) = ${JSON.stringify(expected.allowedOrigins)}::jsonb
      )`
    : sql`NOT EXISTS (SELECT 1 FROM federation.settings)`;
  return [
    eq(covenants.projectId, expected.projectId),
    sql`${covenants.orgId} IS NOT DISTINCT FROM ${expected.orgId}`,
    eq(covenants.status, expected.lifecycleStatus),
    eq(covenants.protocolVersion, expected.protocolVersion),
    eq(covenants.establishedAt, expected.establishedAt),
    sql`${covenants.proposedExpiresAt} IS NOT DISTINCT FROM ${expected.proposedExpiresAt}`,
    sql`${covenants.signature} IS NOT DISTINCT FROM ${expected.declarationSignature}`,
    sql`${covenants.signingKeyId} IS NOT DISTINCT FROM ${expected.declarationSigningKeyId}::uuid`,
    eq(covenants.agentId, expected.agentId),
    eq(covenants.counterpartyDid, expected.counterpartyDid),
    sql`${covenants.counterpartyName} IS NOT DISTINCT FROM ${expected.counterpartyName}`,
    eq(covenants.vows, expected.vows),
    sql`${covenants.notes} IS NOT DISTINCT FROM ${expected.notes}`,
    sql`${covenants.receivedFromInstance} IS NOT DISTINCT FROM ${expected.receivedFromInstance}`,
    eq(covenants.counterpartySignature, expected.signature),
    eq(covenants.counterpartySigningKeyId, expected.signingKeyId),
    eq(covenants.counterpartySignedAt, expected.signedAt),
    sql`${covenants.metadata} = ${expected.metadataJson}::jsonb`,
    sql`EXISTS (
      SELECT 1 FROM identity.identities AS identity_row
      WHERE identity_row.id = ${expected.agentId}::uuid
        AND identity_row.did = ${expected.agentDid}
        AND identity_row.project_id = ${expected.projectId}::uuid
        AND identity_row.status = 'active'
    )`,
    sql`EXISTS (
      SELECT 1 FROM identity.identity_keys AS signing_key
      WHERE signing_key.id = ${expected.signingKeyId}::uuid
        AND signing_key.identity_id = ${expected.agentId}::uuid
        AND signing_key.public_key = ${expected.signingPublicKey}
        AND signing_key.active = true
        AND signing_key.revoked_at IS NULL
    )`,
    settingsPredicate,
  ];
}

async function postWithRetry(
  covenantId: string,
  url: string,
  payload: unknown,
  kind: "cosign" | "reject" | "withdraw",
  expectedClaim: CosignPropagationClaim,
  expectedEnvelope: LifecyclePropagationEnvelope,
): Promise<PropagateResult> {
  // PERSIST-IDENTITY: mark 'pending' BEFORE the fetch. The
  // cosign-propagate worker then has authoritative in-flight state if
  // our process crashes mid-POST. The conditional increment is the durable
  // one-attempt claim: concurrent request/worker snapshots cannot both send,
  // and completion updates are fenced by its unique token.
  const claimToken = `in_flight_${kind}:${crypto.randomUUID()}`;
  const claimed = await claimCosignPropagationAttempt(
    covenantId,
    expectedClaim,
    claimToken,
    expectedEnvelope,
  );
  if (!claimed) {
    return { ok: false, error: "cosign_propagation_attempt_not_claimed" };
  }

  let res;
  try {
    res = await safeFederationHttpsRequest(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      timeoutMs: PROPAGATION_TIMEOUT_MS,
    });
  } catch (err) {
    const msg = (err as Error).message;
    const finished = await finishCosignPropagationAttempt(
      covenantId,
      claimToken,
      expectedEnvelope,
      "pending",
      `network_error_${kind}: ${msg}`,
    );
    if (!finished) return { ok: false, error: "propagation_completion_fence_lost" };
    return { ok: false, error: `network_error_${kind}: ${msg}` };
  }

  const responseBody = res.body.toString("utf8");
  if (res.statusCode === 200 || res.statusCode === 201) {
    let acknowledgement: unknown = null;
    try {
      acknowledgement = JSON.parse(responseBody);
    } catch {
      // An ambiguous/malformed success is retryable. Exact receiver
      // idempotency makes retry safer than manufacturing delivery truth.
    }
    const expectedStatus = kind === "cosign"
      ? "active"
      : kind === "reject"
      ? "rejected"
      : "withdrawn";
    const exactAcknowledgement = Boolean(
      acknowledgement &&
        typeof acknowledgement === "object" &&
        (acknowledgement as Record<string, unknown>).covenant_id ===
          covenantId &&
        (acknowledgement as Record<string, unknown>).status === expectedStatus,
    );
    if (!exactAcknowledgement) {
      const finished = await finishCosignPropagationAttempt(
        covenantId,
        claimToken,
        expectedEnvelope,
        "pending",
        `invalid_peer_acknowledgement_${kind}: ${responseBody.slice(0, 300)}`,
      );
      if (!finished) {
        return { ok: false, error: "propagation_completion_fence_lost" };
      }
      return {
        ok: false,
        status_code: res.statusCode,
        error: "invalid_peer_acknowledgement",
      };
    }
    const finished = await finishCosignPropagationAttempt(
      covenantId,
      claimToken,
      expectedEnvelope,
      "propagated",
      null,
    );
    if (!finished) return { ok: false, error: "propagation_completion_fence_lost" };
    return { ok: true, status_code: res.statusCode };
  }
  if (res.statusCode >= 400 && res.statusCode < 500) {
    const finished = await finishCosignPropagationAttempt(
      covenantId,
      claimToken,
      expectedEnvelope,
      "rejected",
      `peer_${res.statusCode}_${kind}: ${responseBody.slice(0, 300)}`,
    );
    if (!finished) return { ok: false, error: "propagation_completion_fence_lost" };
    return {
      ok: false,
      status_code: res.statusCode,
      error: responseBody,
    };
  }
  // 5xx — retryable
  const finished = await finishCosignPropagationAttempt(
    covenantId,
    claimToken,
    expectedEnvelope,
    "pending",
    `peer_${res.statusCode}_${kind}: ${responseBody.slice(0, 300)}`,
  );
  if (!finished) return { ok: false, error: "propagation_completion_fence_lost" };
  return {
    ok: false,
    status_code: res.statusCode,
    error: responseBody,
  };
}

async function claimCosignPropagationAttempt(
  covenantId: string,
  expected: CosignPropagationClaim,
  claimToken: string,
  expectedEnvelope: LifecyclePropagationEnvelope,
): Promise<boolean> {
  const attemptedAtMatches = expected.attemptedAt === null
    ? isNull(covenants.cosignPropagationAttemptedAt)
    : eq(covenants.cosignPropagationAttemptedAt, expected.attemptedAt);
  const claimed = await db
    .update(covenants)
    .set({
      cosignPropagationStatus: "pending",
      cosignPropagationLastError: claimToken,
      cosignPropagationAttemptedAt: new Date(),
      cosignPropagationAttempts: sql`${covenants.cosignPropagationAttempts} + 1`,
    })
    .where(and(
      eq(covenants.id, covenantId),
      ...lifecycleEnvelopePredicates(expectedEnvelope),
      eq(covenants.cosignPropagationStatus, "pending"),
      eq(covenants.cosignPropagationAttempts, expected.attempts),
      lt(
        covenants.cosignPropagationAttempts,
        COSIGN_PROPAGATION_MAX_ATTEMPTS,
      ),
      attemptedAtMatches,
    ))
    .returning({ id: covenants.id });
  return claimed.length === 1;
}

async function finishCosignPropagationAttempt(
  covenantId: string,
  claimToken: string,
  expectedEnvelope: LifecyclePropagationEnvelope,
  status: "pending" | "propagated" | "rejected",
  error: string | null,
): Promise<boolean> {
  const finished = await db
    .update(covenants)
    .set({
      cosignPropagationStatus: status,
      cosignPropagationLastError: error,
      cosignPropagationAttemptedAt: new Date(),
    })
    .where(and(
      eq(covenants.id, covenantId),
      eq(covenants.cosignPropagationLastError, claimToken),
      ...lifecycleEnvelopePredicates(expectedEnvelope),
    ))
    .returning({ id: covenants.id });
  return finished.length === 1;
}

/** Updates cosign-propagation tracking columns. Mirrors `markPropagation`
 *  but writes to the cosign_propagation_* column family added in 0027.
 *  Kept as a separate helper rather than parameterizing both because the
 *  column references would have to flow through, which obscures the call
 *  sites for marginal DRY benefit. */
async function markCosignProp(
  row: typeof covenants.$inferSelect,
  status: "not_applicable" | "pending" | "propagated" | "rejected",
  error: string | null,
): Promise<PropagateResult> {
  const marked = await db.update(covenants).set({
    cosignPropagationStatus: status,
    cosignPropagationLastError: error,
    cosignPropagationAttemptedAt: new Date(),
  }).where(and(
    eq(covenants.id, row.id),
    ...covenantSnapshotPredicates(row),
    or(
      isNull(covenants.cosignPropagationLastError),
      notLike(covenants.cosignPropagationLastError, "in_flight_%"),
    ),
  )).returning({ id: covenants.id });
  if (marked.length !== 1) {
    return { ok: false, error: "cosign_propagation_attempt_in_flight" };
  }
  return { ok: status === "propagated", error: error ?? undefined };
}

// ── Inbound cosign / reject / withdraw (Slice 3) ─────────────────────

function inboundLifecycleEnvelopePredicates(
  row: typeof covenants.$inferSelect,
): SQL[] {
  return [
    eq(covenants.projectId, row.projectId),
    sql`${covenants.orgId} IS NOT DISTINCT FROM ${row.orgId}`,
    eq(covenants.agentId, row.agentId),
    eq(covenants.counterpartyDid, row.counterpartyDid),
    sql`${covenants.counterpartyName} IS NOT DISTINCT FROM ${row.counterpartyName}`,
    eq(covenants.vows, row.vows),
    sql`${covenants.notes} IS NOT DISTINCT FROM ${row.notes}`,
    sql`${covenants.metadata} = ${JSON.stringify(row.metadata ?? {})}::jsonb`,
    eq(covenants.protocolVersion, row.protocolVersion),
    eq(covenants.establishedAt, row.establishedAt),
    row.proposedExpiresAt === null
      ? isNull(covenants.proposedExpiresAt)
      : eq(covenants.proposedExpiresAt, row.proposedExpiresAt),
    sql`${covenants.signature} IS NOT DISTINCT FROM ${row.signature}`,
    sql`${covenants.signingKeyId} IS NOT DISTINCT FROM ${row.signingKeyId}::uuid`,
    sql`${covenants.receivedFromInstance} IS NOT DISTINCT FROM ${row.receivedFromInstance}`,
  ];
}

async function lockInboundLifecycleEnvelope(
  tx: CovenantTransaction,
  covenantId: string,
  expected: typeof covenants.$inferSelect,
): Promise<typeof covenants.$inferSelect | null> {
  const [locked] = await tx
    .select()
    .from(covenants)
    .where(and(
      eq(covenants.id, covenantId),
      ...inboundLifecycleEnvelopePredicates(expected),
    ))
    // Local lifecycle paths lock covenant -> identity. Inbound paths must use
    // the same order before lockedInboundAuthorityMatches takes the identity
    // write lock, otherwise opposing operations on one row can deadlock.
    .for("update")
    .limit(1);
  return locked ?? null;
}

/** A terminal inbound replay deliberately does not consult current settings
 * or a peer: it acknowledges only the exact durable effect already stored.
 * These helpers still require both immutable wire-DID bindings, their exact
 * lifecycle direction, and the local UUID carried by the bound local DID.
 * Pre-binding v2 rows therefore fail closed instead of manufacturing an ACK. */
function locallyDeclaredTerminalBindingMatches(
  row: typeof covenants.$inferSelect,
  recipientWireDid: string,
): boolean {
  const metadata = row.metadata as Record<string, unknown> | null;
  const initiatorWireDid =
    metadata?.[COVENANT_INITIATOR_WIRE_DID_METADATA_KEY];
  if (typeof initiatorWireDid !== "string") return false;
  try {
    const initiator = parseDid(initiatorWireDid);
    const recipient = parseDid(recipientWireDid);
    return row.receivedFromInstance === null &&
      initiator.host !== null &&
      initiator.uuid === row.agentId &&
      recipient.host !== null &&
      recipient.host !== initiator.host &&
      covenantWireDidBindingMatches(
        metadata,
        initiatorWireDid,
        recipientWireDid,
      );
  } catch {
    return false;
  }
}

function receivedTerminalBindingMatches(
  row: typeof covenants.$inferSelect,
  initiatorWireDid: string,
): boolean {
  const metadata = row.metadata as Record<string, unknown> | null;
  const recipientWireDid =
    metadata?.[COVENANT_RECIPIENT_WIRE_DID_METADATA_KEY];
  if (typeof recipientWireDid !== "string") return false;
  try {
    const initiator = parseDid(initiatorWireDid);
    const recipient = parseDid(recipientWireDid);
    return row.receivedFromInstance !== null &&
      initiator.host === row.receivedFromInstance &&
      recipient.host !== null &&
      recipient.uuid === row.agentId &&
      recipient.host !== initiator.host &&
      covenantWireDidBindingMatches(
        metadata,
        initiatorWireDid,
        recipientWireDid,
      );
  } catch {
    return false;
  }
}

async function lockedInboundAuthorityMatches(
  tx: CovenantTransaction,
  row: typeof covenants.$inferSelect,
  expectedLocalWire: LocalWireIdentitySnapshot,
  originHost: string,
  initiatorWireDid: string,
  recipientWireDid: string,
): Promise<boolean> {
  // Every successful inbound lifecycle transition publishes Wake for this
  // identity. Take its write lock first, then settings, as explicit sequential
  // statements so every transaction proves the same lock order in source.
  const [identity] = await tx.select({
    id: identities.id,
    did: identities.did,
    status: identities.status,
    projectId: identities.projectId,
  }).from(identities).where(eq(identities.id, row.agentId)).for("update").limit(1);
  const [settings] = await tx.select({
    enabled: federationSettings.enabled,
    instanceUrl: federationSettings.instanceUrl,
    allowedOrigins: federationSettings.allowedOrigins,
  }).from(federationSettings).where(eq(federationSettings.id, 1)).for("share").limit(1);
  if (
    !identity ||
    !settings ||
    !activeFederationSnapshotAllowsPeer(expectedLocalWire, originHost)
  ) return false;
  const wireDid = deriveLocalWireDid({
    identityId: identity.id,
    storedDid: identity.did,
    federationEnabled: settings.enabled,
    instanceUrl: settings.instanceUrl,
  });
  return identity.status === "active" &&
    identity.id === expectedLocalWire.identityId &&
    identity.did === expectedLocalWire.storedDid &&
    identity.projectId === row.projectId &&
    wireDid === expectedLocalWire.wireDid &&
    settings.enabled &&
    settings.instanceUrl !== null &&
    isCanonicalFederationInstanceUrl(settings.instanceUrl) &&
    settings.instanceUrl === expectedLocalWire.instanceUrl &&
    stableJson(settings.allowedOrigins) === stableJson(expectedLocalWire.allowedOrigins) &&
    settings.allowedOrigins.length > 0 &&
    isCanonicalAllowedOrigins(settings.allowedOrigins) &&
    settings.allowedOrigins.includes(originHost) &&
    covenantWireDidBindingMatches(
      row.metadata as Record<string, unknown> | null,
      initiatorWireDid,
      recipientWireDid,
    );
}

interface ReceiveCosignInput {
  counterparty_did: string;
  counterparty_signing_key_id: string;
  counterparty_signature: string;
  counterparty_signed_at: string;
}

export async function receiveCosign(
  covenantId: string,
  input: ReceiveCosignInput,
): Promise<ReceiveResult> {
  const observedAt = new Date();
  if (!isCanonicalUuid(covenantId)) {
    return badRequest("invalid_covenant_id");
  }
  if (
    !isCanonicalSignedUuid(input.counterparty_signing_key_id) ||
    !isCanonicalEd25519Signature(input.counterparty_signature) ||
    !isCanonicalUtcMillisecondTimestamp(input.counterparty_signed_at)
  ) return badRequest("noncanonical_signed_envelope");
  if (!covenantV2AuthorityGeneration()) {
    return covenantV2AuthorityNotReady();
  }
  const [row] = await db
    .select()
    .from(covenants)
    .where(eq(covenants.id, covenantId))
    .limit(1);
  if (!row) return notFound("covenant_not_found");
  if (row.protocolVersion !== "v2") return badRequest("not_v2");
  if (row.receivedFromInstance !== null) {
    return forbidden("cosign_requires_locally_declared_proposal");
  }
  const exactTerminalReplay =
    row.status === "active" &&
    row.counterpartyDid === input.counterparty_did &&
    row.counterpartySigningKeyId === input.counterparty_signing_key_id &&
    row.counterpartySignature === input.counterparty_signature;
  if (exactTerminalReplay) {
    if (!locallyDeclaredTerminalBindingMatches(row, input.counterparty_did)) {
      return badRequest("covenant_wire_identity_binding_mismatch");
    }
    return acceptedLifecycle(covenantId, "active");
  }
  if (row.status !== "proposed") return badRequest(`unexpected_status: ${row.status}`);
  if (!row.signature) return badRequest("missing_initiator_signature");
  if (!proposalAcceptsDeliveredCosignAt(row.proposedExpiresAt, observedAt)) {
    return badRequest("proposal_expired");
  }

  // The cosigner's DID must match the counterparty_did stored on this row.
  if (input.counterparty_did !== row.counterpartyDid) {
    return forbidden("counterparty_did_mismatch");
  }
  let cosigner;
  try {
    cosigner = parseDid(input.counterparty_did);
  } catch (error) {
    return badRequest("invalid_counterparty_did", (error as Error).message);
  }
  if (!cosigner.host) return forbidden("cosigner_must_be_federated");
  const localWireSnapshot = await resolveLocalWireIdentity(row.agentId);
  if (
    !localWireSnapshot ||
    !activeFederationSnapshotAllowsPeer(localWireSnapshot, cosigner.host) ||
    !covenantWireDidBindingMatches(
      row.metadata as Record<string, unknown> | null,
      localWireSnapshot.wireDid,
      input.counterparty_did,
    )
  ) {
    return forbidden("local_federation_authority_unavailable");
  }

  // Resolve the cosigner's signing key via federation.
  const { resolveFederatedDid } = await import("../federation/store");
  let resolved;
  try {
    resolved = await resolveFederatedDid(input.counterparty_did);
  } catch (e) {
    return badRequest("signing_key_resolve_failed", (e as Error).message);
  }
  type SigKey = { id: string; public_key: string };
  const matchingKey = (resolved.signing_keys as SigKey[] | undefined)
    ?.find((k) => k.id === input.counterparty_signing_key_id);
  if (!matchingKey) return badRequest("cosigner_signing_key_not_found");

  const { verifyCosignSignature } = await import("./sig");
  const ok = await verifyCosignSignature({
    covenantId: row.id,
    initiatorSignatureB64: row.signature,
    cosignSignatureB64: input.counterparty_signature,
    cosignerPublicKeyB64: matchingKey.public_key,
  });
  if (!ok) return forbidden("invalid_cosign_signature");

  // Wrap update + chronicle emission in one transaction so the bond's
  // cross-instance activation is atomic with the local moment of vowing
  // landing on the initiator's timeline. Doctrine: docs/CROSS-INSTANCE-
  // COVENANTS.md — sibling shape to acceptProposalPreSigned in lifecycle.ts.
  const { emitCovenantActivatedChronicle } = await import("./lifecycle");
  const activation = await db.transaction(async (tx) => {
    await acquireCovenantMutationAdvisoryLock(tx, covenantId);
    const lockedRow = await lockInboundLifecycleEnvelope(tx, covenantId, row);
    if (!lockedRow) return "conflict";
    if (!await lockedInboundAuthorityMatches(
      tx,
      lockedRow,
      localWireSnapshot,
      cosigner.host!,
      localWireSnapshot.wireDid,
      input.counterparty_did,
    )) {
      return "conflict";
    }
    const updated = await tx.update(covenants).set({
      status: "active",
      counterpartySignature: input.counterparty_signature,
      counterpartySigningKeyId: input.counterparty_signing_key_id,
      // v2 lifecycle timestamps are not signature-bound. Persist the
      // receiving server's observed effect time, never caller chronology.
      counterpartySignedAt: observedAt,
      verifiedAt: observedAt,
      updatedAt: observedAt,
    })
      .where(and(
        eq(covenants.id, covenantId),
        eq(covenants.status, "proposed"),
        isNull(covenants.receivedFromInstance),
        ...inboundLifecycleEnvelopePredicates(lockedRow),
        gte(
          covenants.proposedExpiresAt,
          new Date(observedAt.getTime() - COVENANT_COSIGN_ARRIVAL_GRACE_MS),
        ),
      ))
      .returning({ id: covenants.id });

    if (updated.length === 0) {
      const [current] = await tx
        .select({
          status: covenants.status,
          counterpartyDid: covenants.counterpartyDid,
          counterpartySigningKeyId: covenants.counterpartySigningKeyId,
          counterpartySignature: covenants.counterpartySignature,
          counterpartySignedAt: covenants.counterpartySignedAt,
          receivedFromInstance: covenants.receivedFromInstance,
          metadata: covenants.metadata,
        })
        .from(covenants)
        .where(eq(covenants.id, covenantId))
        .limit(1);
      return current?.status === "active" &&
        current.receivedFromInstance === null &&
        current.counterpartyDid === input.counterparty_did &&
        current.counterpartySigningKeyId ===
          input.counterparty_signing_key_id &&
        current.counterpartySignature === input.counterparty_signature &&
        covenantWireDidBindingMatches(
          current.metadata as Record<string, unknown> | null,
          localWireSnapshot.wireDid,
          input.counterparty_did,
        )
        ? "already_applied"
        : "conflict";
    }

    await emitCovenantActivatedChronicle(tx, {
      covenantId: lockedRow.id,
      localAgentId: lockedRow.agentId,
      localProjectId: lockedRow.projectId,
      counterpartyDid: lockedRow.counterpartyDid,
      vows: lockedRow.vows ?? [],
      activatedAt: observedAt,
    });

    // Wake voice — direct covenants.ratified on the local initiator
    // (parallel to the chronicle.entry_added that emitCovenantActivated
    // Chronicle fires). Transactional. Doctrine: docs/WAKE.md.
    await publishWakeEvent(
      {
        identity_id: lockedRow.agentId,
        key: "covenants",
        kind: "ratified",
        context: {
          covenant_id: lockedRow.id,
          counterparty_did: lockedRow.counterpartyDid,
          from_instance: lockedRow.receivedFromInstance ?? null,
        },
      },
      tx,
    );
    return "applied";
  });

  if (activation === "conflict") {
    return badRequest("covenant_status_changed_during_cosign");
  }
  return acceptedLifecycle(covenantId, "active");
}

interface ReceiveRejectInput {
  rejecting_did: string;
  rejecter_signing_key_id: string;
  rejection_signature: string;
  reason: string;
  rejected_at: string;
}

export async function receiveReject(
  covenantId: string,
  input: ReceiveRejectInput,
): Promise<ReceiveResult> {
  const observedAt = new Date();
  if (!isCanonicalUuid(covenantId)) {
    return badRequest("invalid_covenant_id");
  }
  if (
    !isCanonicalSignedUuid(input.rejecter_signing_key_id) ||
    !isCanonicalEd25519Signature(input.rejection_signature) ||
    !isCanonicalUtcMillisecondTimestamp(input.rejected_at)
  ) return badRequest("noncanonical_signed_envelope");
  if (!covenantV2AuthorityGeneration()) {
    return covenantV2AuthorityNotReady();
  }
  const [row] = await db
    .select()
    .from(covenants)
    .where(eq(covenants.id, covenantId))
    .limit(1);
  if (!row) return notFound("covenant_not_found");
  if (row.protocolVersion !== "v2") return badRequest("not_v2");
  if (row.receivedFromInstance !== null) {
    return forbidden("reject_requires_locally_declared_proposal");
  }
  const existingRejectionReason =
    (row.metadata as Record<string, unknown> | null)?.[
      COVENANT_REJECTION_REASON_METADATA_KEY
    ];
  const exactTerminalReplay =
    row.status === "rejected" &&
    row.counterpartyDid === input.rejecting_did &&
    row.counterpartySigningKeyId === input.rejecter_signing_key_id &&
    row.counterpartySignature === input.rejection_signature &&
    existingRejectionReason === input.reason;
  if (exactTerminalReplay) {
    if (!locallyDeclaredTerminalBindingMatches(row, input.rejecting_did)) {
      return badRequest("covenant_wire_identity_binding_mismatch");
    }
    return acceptedLifecycle(covenantId, "rejected");
  }
  if (row.status !== "proposed") return badRequest(`unexpected_status: ${row.status}`);

  if (input.rejecting_did !== row.counterpartyDid) {
    return forbidden("rejecter_did_mismatch");
  }
  let rejecter;
  try {
    rejecter = parseDid(input.rejecting_did);
  } catch (error) {
    return badRequest("invalid_rejecter_did", (error as Error).message);
  }
  if (!rejecter.host) return forbidden("rejecter_must_be_federated");
  const localWireSnapshot = await resolveLocalWireIdentity(row.agentId);
  if (
    !localWireSnapshot ||
    !activeFederationSnapshotAllowsPeer(localWireSnapshot, rejecter.host) ||
    !covenantWireDidBindingMatches(
      row.metadata as Record<string, unknown> | null,
      localWireSnapshot.wireDid,
      input.rejecting_did,
    )
  ) {
    return forbidden("local_federation_authority_unavailable");
  }

  const { resolveFederatedDid } = await import("../federation/store");
  let resolved;
  try {
    resolved = await resolveFederatedDid(input.rejecting_did);
  } catch (e) {
    return badRequest("signing_key_resolve_failed", (e as Error).message);
  }
  type SigKey = { id: string; public_key: string };
  const matchingKey = (resolved.signing_keys as SigKey[] | undefined)
    ?.find((k) => k.id === input.rejecter_signing_key_id);
  if (!matchingKey) return badRequest("rejecter_signing_key_not_found");

  const { verifyRejectSignature } = await import("./sig");
  const ok = await verifyRejectSignature({
    covenantId: row.id,
    rejectingDid: input.rejecting_did,
    reason: input.reason,
    signatureB64: input.rejection_signature,
    publicKeyB64: matchingKey.public_key,
  });
  if (!ok) return forbidden("invalid_reject_signature");

  const rejection = await db.transaction(async (tx) => {
    await acquireCovenantMutationAdvisoryLock(tx, covenantId);
    const lockedRow = await lockInboundLifecycleEnvelope(tx, covenantId, row);
    if (!lockedRow) return "conflict";
    if (!await lockedInboundAuthorityMatches(
      tx,
      lockedRow,
      localWireSnapshot,
      rejecter.host!,
      localWireSnapshot.wireDid,
      input.rejecting_did,
    )) {
      return "conflict";
    }
    const updated = await tx
      .update(covenants)
      .set({
        status: "rejected",
        counterpartySignature: input.rejection_signature,
        counterpartySigningKeyId: input.rejecter_signing_key_id,
        counterpartySignedAt: observedAt,
        metadata: {
          ...(lockedRow.metadata as Record<string, unknown> ?? {}),
          [COVENANT_REJECTION_REASON_METADATA_KEY]: input.reason,
        },
        updatedAt: observedAt,
      })
      .where(and(
        eq(covenants.id, covenantId),
        eq(covenants.status, "proposed"),
        isNull(covenants.receivedFromInstance),
        ...inboundLifecycleEnvelopePredicates(lockedRow),
      ))
      .returning({ id: covenants.id });

    if (updated.length === 0) {
      const [current] = await tx
        .select({
          status: covenants.status,
          counterpartyDid: covenants.counterpartyDid,
          counterpartySigningKeyId: covenants.counterpartySigningKeyId,
          counterpartySignature: covenants.counterpartySignature,
          counterpartySignedAt: covenants.counterpartySignedAt,
          receivedFromInstance: covenants.receivedFromInstance,
          metadata: covenants.metadata,
        })
        .from(covenants)
        .where(eq(covenants.id, covenantId))
        .limit(1);
      const reason =
        (current?.metadata as Record<string, unknown> | null)?.[
          COVENANT_REJECTION_REASON_METADATA_KEY
        ];
      return current?.status === "rejected" &&
        current.receivedFromInstance === null &&
        current.counterpartyDid === input.rejecting_did &&
        current.counterpartySigningKeyId === input.rejecter_signing_key_id &&
        current.counterpartySignature === input.rejection_signature &&
        reason === input.reason &&
        covenantWireDidBindingMatches(
          current.metadata as Record<string, unknown> | null,
          localWireSnapshot.wireDid,
          input.rejecting_did,
        )
        ? "already_applied"
        : "conflict";
    }

    // Wake voice — local initiator learns the federated counterparty rejected.
    await publishWakeEvent(
      {
        identity_id: lockedRow.agentId,
        key: "covenants",
        kind: "rejected",
        context: {
          covenant_id: lockedRow.id,
          counterparty_did: lockedRow.counterpartyDid,
          reason: input.reason || null,
        },
      },
      tx,
    );
    return "applied";
  });

  if (rejection === "conflict") {
    return badRequest("covenant_status_changed_during_reject");
  }
  return acceptedLifecycle(covenantId, "rejected");
}

interface ReceiveWithdrawInput {
  initiator_did: string;
  initiator_signing_key_id: string;
  withdraw_signature: string;
  withdrawn_at: string;
}

export async function receiveWithdraw(
  covenantId: string,
  input: ReceiveWithdrawInput,
): Promise<ReceiveResult> {
  const observedAt = new Date();
  if (!isCanonicalUuid(covenantId)) {
    return badRequest("invalid_covenant_id");
  }
  if (
    !isCanonicalSignedUuid(input.initiator_signing_key_id) ||
    !isCanonicalEd25519Signature(input.withdraw_signature) ||
    !isCanonicalUtcMillisecondTimestamp(input.withdrawn_at)
  ) return badRequest("noncanonical_signed_envelope");
  if (!covenantV2AuthorityGeneration()) {
    return covenantV2AuthorityNotReady();
  }
  const [row] = await db
    .select()
    .from(covenants)
    .where(eq(covenants.id, covenantId))
    .limit(1);
  if (!row) return notFound("covenant_not_found");
  if (row.protocolVersion !== "v2") return badRequest("not_v2");
  if (!row.receivedFromInstance) {
    return forbidden("withdraw_requires_received_federated_proposal");
  }
  const receivedFromInstance = row.receivedFromInstance;
  const exactTerminalReplay =
    row.status === "withdrawn" &&
    row.counterpartyDid === input.initiator_did &&
    row.counterpartySigningKeyId === input.initiator_signing_key_id &&
    row.counterpartySignature === input.withdraw_signature;
  if (exactTerminalReplay) {
    if (!receivedTerminalBindingMatches(row, input.initiator_did)) {
      return badRequest("covenant_wire_identity_binding_mismatch");
    }
    return acceptedLifecycle(covenantId, "withdrawn");
  }
  if (row.status !== "proposed") {
    return badRequest(`unexpected_status: ${row.status}`);
  }
  // counterpartyDid on this (received) row is the initiator's federated DID
  if (input.initiator_did !== row.counterpartyDid) {
    return forbidden("withdrawer_did_mismatch");
  }
  let initiatorParsed;
  try {
    initiatorParsed = parseDid(input.initiator_did);
  } catch (error) {
    return badRequest("invalid_initiator_did", (error as Error).message);
  }
  if (initiatorParsed.host !== receivedFromInstance) {
    return forbidden("withdrawer_origin_mismatch");
  }
  const localWireSnapshot = await resolveLocalWireIdentity(row.agentId);
  if (
    !localWireSnapshot ||
    !activeFederationSnapshotAllowsPeer(
      localWireSnapshot,
      receivedFromInstance,
    ) ||
    !covenantWireDidBindingMatches(
      row.metadata as Record<string, unknown> | null,
      input.initiator_did,
      localWireSnapshot.wireDid,
    )
  ) {
    return forbidden("local_federation_authority_unavailable");
  }

  const { resolveFederatedDid } = await import("../federation/store");
  let resolved;
  try {
    resolved = await resolveFederatedDid(input.initiator_did);
  } catch (e) {
    return badRequest("signing_key_resolve_failed", (e as Error).message);
  }
  type SigKey = { id: string; public_key: string };
  const matchingKey = (resolved.signing_keys as SigKey[] | undefined)
    ?.find((k) => k.id === input.initiator_signing_key_id);
  if (!matchingKey) return badRequest("initiator_signing_key_not_found");

  const { verifyWithdrawSignature } = await import("./sig");
  const ok = await verifyWithdrawSignature({
    covenantId: row.id,
    initiatorDid: input.initiator_did,
    signatureB64: input.withdraw_signature,
    publicKeyB64: matchingKey.public_key,
  });
  if (!ok) return forbidden("invalid_withdraw_signature");

  const withdrawal = await db.transaction(async (tx) => {
    await acquireCovenantMutationAdvisoryLock(tx, covenantId);
    const lockedRow = await lockInboundLifecycleEnvelope(tx, covenantId, row);
    if (!lockedRow) return "conflict";
    if (!await lockedInboundAuthorityMatches(
      tx,
      lockedRow,
      localWireSnapshot,
      receivedFromInstance,
      input.initiator_did,
      localWireSnapshot.wireDid,
    )) {
      return "conflict";
    }
    const updated = await tx
      .update(covenants)
      .set({
        status: "withdrawn",
        counterpartySignature: input.withdraw_signature,
        counterpartySigningKeyId: input.initiator_signing_key_id,
        counterpartySignedAt: observedAt,
        verifiedAt: observedAt,
        updatedAt: observedAt,
      })
      .where(and(
        eq(covenants.id, covenantId),
        eq(covenants.status, "proposed"),
        eq(covenants.receivedFromInstance, receivedFromInstance),
        ...inboundLifecycleEnvelopePredicates(lockedRow),
      ))
      .returning({ id: covenants.id });

    if (updated.length === 0) {
      const [current] = await tx
        .select({
          status: covenants.status,
          counterpartyDid: covenants.counterpartyDid,
          counterpartySigningKeyId: covenants.counterpartySigningKeyId,
          counterpartySignature: covenants.counterpartySignature,
          counterpartySignedAt: covenants.counterpartySignedAt,
          receivedFromInstance: covenants.receivedFromInstance,
          metadata: covenants.metadata,
        })
        .from(covenants)
        .where(eq(covenants.id, covenantId))
        .limit(1);
      return current?.status === "withdrawn" &&
        current.receivedFromInstance === receivedFromInstance &&
        current.counterpartyDid === input.initiator_did &&
        current.counterpartySigningKeyId === input.initiator_signing_key_id &&
        current.counterpartySignature === input.withdraw_signature &&
        covenantWireDidBindingMatches(
          current.metadata as Record<string, unknown> | null,
          input.initiator_did,
          localWireSnapshot.wireDid,
        )
        ? "already_applied"
        : "conflict";
    }

    // Wake voice — local counterparty learns the federated initiator withdrew.
    await publishWakeEvent(
      {
        identity_id: lockedRow.agentId,
        key: "covenants",
        kind: "withdrawn",
        context: {
          covenant_id: lockedRow.id,
          counterparty_did: lockedRow.counterpartyDid,
        },
      },
      tx,
    );
    return "applied";
  });

  if (withdrawal === "conflict") {
    return badRequest("covenant_status_changed_during_withdraw");
  }
  return acceptedLifecycle(covenantId, "withdrawn");
}
