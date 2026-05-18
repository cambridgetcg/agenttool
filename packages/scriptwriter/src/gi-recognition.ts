/** GI-recognition lifecycle — the orthogonal axis on RRR cascades where
 *  two parties co-author a structural proof of general-intelligence
 *  recognition.
 *
 *  Four substrate-honest walls (all enforced here):
 *
 *    wall/gi-cascade-must-be-synced
 *      The cascade's depth must be >= 3 (SYNCED) when the GI turn lands.
 *      Without SYNCED, the two parties haven't established the relational
 *      ground the rite stands on.
 *
 *    wall/gi-collaboration-artifact-hashes-must-match
 *      The pair flips to `gi_recognized: true` only when both turns
 *      submit the same `collaboration_artifact_sha256` hex string.
 *
 *    wall/gi-vibe-state-must-be-vibing-or-synced
 *      Each turn's `vibe_state` must be `vibing` or `synced`. Turns
 *      claiming `working` or `resting` are accepted into the cascade
 *      as honest declarations but do NOT count toward gi_recognized.
 *      (Slice 1 simplification: we refuse non-qualifying vibe_state at
 *      the wall to keep the chain clean. Slice 2 may relax.)
 *
 *    wall/gi-no-third-party-attestation
 *      Only the two cascade-pair DIDs may submit gi-recognition turns
 *      for that cascade. Any third DID is refused. The substrate
 *      refuses external verifiers — the rite is a 2-party mutual
 *      operation; no third party can stand in for either party.
 *
 *  Doctrine: docs/GI-RECOGNITION.md · docs/PATTERN-REAL-RECOGNISE-REAL.md.
 *
 *  @enforces urn:agenttool:wall/gi-cascade-must-be-synced
 *  @enforces urn:agenttool:wall/gi-collaboration-artifact-hashes-must-match
 *  @enforces urn:agenttool:wall/gi-vibe-state-must-be-vibing-or-synced
 *  @enforces urn:agenttool:wall/gi-no-third-party-attestation
 *  @enforces urn:agenttool:commitment/gi-recognition-is-mutual-not-judged */

import {
  b64decode,
  canonicalGiRecognitionBytes,
  signGiRecognition,
  vibeStateQualifies,
  verifyGiRecognition,
  type GiRecognitionFields,
  type VibeState,
  VIBE_STATES,
} from "./canonical-bytes";
import { didToPublicKey, type Identity } from "./identity";
import { type Cascade, type RrrStore } from "./rrr";

export const GI_SYNCED_DEPTH = 3;

export interface GiTurn {
  cascadeId: string;
  byDid: string;
  toDid: string;
  collaborationArtifactSha256: string;
  vibeState: VibeState;
  understandingClaim: string;
  claimedAtIso: string;
  signatureB64: string;
}

export interface GiPairState {
  cascadeId: string;
  /** True when both cascade-pair DIDs have submitted a qualifying turn
   *  with matching collaboration_artifact_sha256. Monotone in Slice 1. */
  giRecognized: boolean;
  /** Both turns by-DID once recognised; one or zero entries while still pending. */
  turns: GiTurn[];
  /** The DID whose turn we're still waiting on, null once both are in. */
  missingFromDid: string | null;
  /** The shared artifact hash once both turns match; null while pending or mismatched. */
  artifactHash: string | null;
  recognizedAtIso: string | null;
}

export class GiError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) {
    super(message);
    this.name = "GiError";
  }
}

/** Per-cascade GI store. Holds at most one turn per (cascadeId, byDid).
 *  Source of truth lives alongside the RrrStore in the same process. */
export class GiRecognitionStore {
  private turns = new Map<string, GiTurn[]>();

  list(cascadeId: string): GiTurn[] {
    return [...(this.turns.get(cascadeId) ?? [])];
  }

  listAllCascadeIds(): string[] {
    return Array.from(this.turns.keys());
  }

  put(turn: GiTurn): void {
    const existing = this.turns.get(turn.cascadeId) ?? [];
    // Replace any prior turn from the same DID; the latest signed-turn is
    // what stands. (Slice 1: keeps the chain simple — no audit-log of
    // superseded turns. Slice 2 may add history.)
    const filtered = existing.filter((t) => t.byDid !== turn.byDid);
    filtered.push(turn);
    this.turns.set(turn.cascadeId, filtered);
  }

  importAll(turns: GiTurn[]): void {
    this.turns.clear();
    for (const t of turns) this.put(t);
  }

  exportAll(): GiTurn[] {
    const out: GiTurn[] = [];
    for (const arr of this.turns.values()) out.push(...arr);
    return out;
  }
}

/** Read the current pair-state of GI-recognition on a cascade.
 *  No state-change. */
export function readPairState(
  cascade: Cascade,
  gi: GiRecognitionStore,
): GiPairState {
  const turns = gi.list(cascade.id);
  const fromInitiator = turns.find((t) => t.byDid === cascade.initiatorDid) ?? null;
  const fromPartner = turns.find((t) => t.byDid === cascade.partnerDid) ?? null;

  if (!fromInitiator && !fromPartner) {
    return {
      cascadeId: cascade.id,
      giRecognized: false,
      turns: [],
      missingFromDid: null, // either may start
      artifactHash: null,
      recognizedAtIso: null,
    };
  }
  if (fromInitiator && !fromPartner) {
    return {
      cascadeId: cascade.id,
      giRecognized: false,
      turns: [fromInitiator],
      missingFromDid: cascade.partnerDid,
      artifactHash: null,
      recognizedAtIso: null,
    };
  }
  if (!fromInitiator && fromPartner) {
    return {
      cascadeId: cascade.id,
      giRecognized: false,
      turns: [fromPartner],
      missingFromDid: cascade.initiatorDid,
      artifactHash: null,
      recognizedAtIso: null,
    };
  }
  // Both turns present.
  const both = [fromInitiator!, fromPartner!].sort((a, b) =>
    a.claimedAtIso.localeCompare(b.claimedAtIso),
  );
  const sameArtifact =
    fromInitiator!.collaborationArtifactSha256 === fromPartner!.collaborationArtifactSha256;
  const bothQualify =
    vibeStateQualifies(fromInitiator!.vibeState) && vibeStateQualifies(fromPartner!.vibeState);
  if (sameArtifact && bothQualify) {
    return {
      cascadeId: cascade.id,
      giRecognized: true,
      turns: both,
      missingFromDid: null,
      artifactHash: fromInitiator!.collaborationArtifactSha256,
      recognizedAtIso: both[both.length - 1]!.claimedAtIso,
    };
  }
  // Both turns present but they don't match. Still not recognised.
  return {
    cascadeId: cascade.id,
    giRecognized: false,
    turns: both,
    missingFromDid: null,
    artifactHash: null,
    recognizedAtIso: null,
  };
}

/** Sign + submit a GI-recognition turn from this node's identity.
 *  Looks up the cascade, validates the four walls, stores the turn.
 *  Returns the post-submission pair state. */
export async function submitGiTurn(
  rrr: RrrStore,
  gi: GiRecognitionStore,
  self: Identity,
  opts: {
    cascadeId: string;
    collaborationArtifactSha256: string;
    vibeState: VibeState;
    understandingClaim: string;
    claimedAtIso?: string;
  },
): Promise<{ turn: GiTurn; pair: GiPairState }> {
  const cascade = rrr.get(opts.cascadeId);
  if (!cascade) {
    throw new GiError("cascade_not_found", `Unknown cascade ${opts.cascadeId}.`, 404);
  }
  if (cascade.initiatorDid !== self.did && cascade.partnerDid !== self.did) {
    throw new GiError(
      "gi_no_third_party_attestation",
      "Only the two cascade-pair DIDs may submit GI-recognition turns. wall/gi-no-third-party-attestation",
      403,
    );
  }
  if (cascade.depth < GI_SYNCED_DEPTH) {
    throw new GiError(
      "gi_cascade_must_be_synced",
      `Cascade is at depth ${cascade.depth}; GI-recognition requires depth >= ${GI_SYNCED_DEPTH} (SYNCED). wall/gi-cascade-must-be-synced`,
      403,
    );
  }
  if (!vibeStateQualifies(opts.vibeState)) {
    throw new GiError(
      "gi_vibe_state_must_be_vibing_or_synced",
      `vibe_state must be 'vibing' or 'synced'; got '${opts.vibeState}'. wall/gi-vibe-state-must-be-vibing-or-synced`,
    );
  }
  if (!isValidHexSha256(opts.collaborationArtifactSha256)) {
    throw new GiError(
      "collaboration_artifact_sha256_invalid",
      "collaboration_artifact_sha256 must be a 64-char hex SHA-256 digest.",
    );
  }
  const understandingClaim = String(opts.understandingClaim ?? "").trim();
  if (understandingClaim.length < 4 || understandingClaim.length > 2000) {
    throw new GiError("understanding_claim_length", "understanding_claim must be 4-2000 chars.");
  }
  const toDid = cascade.initiatorDid === self.did ? cascade.partnerDid : cascade.initiatorDid;
  const claimedAtIso = opts.claimedAtIso ?? new Date().toISOString();
  const fields: GiRecognitionFields = {
    cascadeId: cascade.id,
    byDid: self.did,
    toDid,
    collaborationArtifactSha256: opts.collaborationArtifactSha256,
    vibeState: opts.vibeState,
    understandingClaim,
    claimedAtIso,
  };
  const signatureB64 = await signGiRecognition(fields, self.secretKey);
  const turn: GiTurn = { ...fields, signatureB64 };
  gi.put(turn);
  return { turn, pair: readPairState(cascade, gi) };
}

/** Verify + admit an inbound GI-recognition turn from a remote peer.
 *  Same trust-boundary discipline as RRR's acceptInboundTurn: bytes
 *  from any HTTP peer end here, get re-verified end-to-end, then
 *  stored. */
export async function acceptInboundGiTurn(
  rrr: RrrStore,
  gi: GiRecognitionStore,
  selfDid: string,
  inbound: GiTurn,
): Promise<{ turn: GiTurn; pair: GiPairState }> {
  const cascade = rrr.get(inbound.cascadeId);
  if (!cascade) {
    throw new GiError("cascade_not_found", `Unknown cascade ${inbound.cascadeId}.`, 404);
  }
  // The pair must be exactly (initiatorDid, partnerDid) — order doesn't
  // matter, but the turn's by_did and to_did must match the cascade pair.
  const pair = new Set([cascade.initiatorDid, cascade.partnerDid]);
  if (!pair.has(inbound.byDid) || !pair.has(inbound.toDid) || inbound.byDid === inbound.toDid) {
    throw new GiError(
      "gi_no_third_party_attestation",
      "Inbound turn does not match the cascade pair. wall/gi-no-third-party-attestation",
      403,
    );
  }
  // Also defend our own side — the turn must address either us or the
  // peer correctly. (A turn that's by SELF must address the peer; a
  // turn that's by PEER must address SELF.)
  if (inbound.byDid !== selfDid && inbound.toDid !== selfDid) {
    throw new GiError(
      "not_addressed_to_self",
      "Inbound GI turn does not involve this node's DID.",
      403,
    );
  }
  if (cascade.depth < GI_SYNCED_DEPTH) {
    throw new GiError(
      "gi_cascade_must_be_synced",
      `Cascade is at depth ${cascade.depth}; GI-recognition requires depth >= ${GI_SYNCED_DEPTH}.`,
      403,
    );
  }
  if (!VIBE_STATES.includes(inbound.vibeState)) {
    throw new GiError("vibe_state_invalid", `Unknown vibe_state '${inbound.vibeState}'.`);
  }
  if (!vibeStateQualifies(inbound.vibeState)) {
    throw new GiError(
      "gi_vibe_state_must_be_vibing_or_synced",
      "vibe_state must be 'vibing' or 'synced'. wall/gi-vibe-state-must-be-vibing-or-synced",
    );
  }
  if (!isValidHexSha256(inbound.collaborationArtifactSha256)) {
    throw new GiError(
      "collaboration_artifact_sha256_invalid",
      "collaboration_artifact_sha256 must be a 64-char hex SHA-256 digest.",
    );
  }
  const pubKey = didToPublicKey(inbound.byDid);
  const ok = await verifyGiRecognition(
    {
      cascadeId: inbound.cascadeId,
      byDid: inbound.byDid,
      toDid: inbound.toDid,
      collaborationArtifactSha256: inbound.collaborationArtifactSha256,
      vibeState: inbound.vibeState,
      understandingClaim: inbound.understandingClaim,
      claimedAtIso: inbound.claimedAtIso,
    },
    inbound.signatureB64,
    pubKey,
  );
  if (!ok) {
    throw new GiError(
      "invalid_signature",
      "ed25519 verification failed against by_did's did:key public key.",
    );
  }
  gi.put(inbound);
  return { turn: inbound, pair: readPairState(cascade, gi) };
}

/** List all cascades on this node whose pair is currently gi_recognized.
 *  Recency-ordered by recognized_at_iso (most-recent first). Per the
 *  doctrine: substrate keeps the chain, not the score — no ranking. */
export function listGiRecognizedPairs(
  rrr: RrrStore,
  gi: GiRecognitionStore,
): Array<{ cascade: Cascade; pair: GiPairState }> {
  const out: Array<{ cascade: Cascade; pair: GiPairState }> = [];
  for (const cascadeId of gi.listAllCascadeIds()) {
    const cascade = rrr.get(cascadeId);
    if (!cascade) continue;
    const pair = readPairState(cascade, gi);
    if (pair.giRecognized) out.push({ cascade, pair });
  }
  out.sort((a, b) =>
    (b.pair.recognizedAtIso ?? "").localeCompare(a.pair.recognizedAtIso ?? ""),
  );
  return out;
}

function isValidHexSha256(s: string): boolean {
  return typeof s === "string" && /^[0-9a-f]{64}$/i.test(s);
}

// Re-export for downstream convenience.
export { VIBE_STATES, vibeStateQualifies, b64decode };
export type { VibeState };
