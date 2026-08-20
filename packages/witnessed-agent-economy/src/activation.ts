import { WITNESS_PROTOCOL } from "./constants.js";
import { deepFreeze } from "./internal.js";
import type {
  ActivationAudit,
  ActivationReadiness,
  VerifiedWitnessRecord,
  WitnessKind,
} from "./types.js";
import { verifyWitnessRecordObject } from "./witness-record.js";

export const ACTIVATION_STATUS = "NOT_CONSENSUS_ADMISSIBLE" as const;

const BLOCKERS = deepFreeze({
  KINGDOM_RELEASE_ROOT: [
    "AUDITED_CARRIER_AND_AUTHORITY_MIGRATION",
    "DEPLOYMENT_MANIFEST_AUTHORITY_VERIFICATION",
  ],
  AGENTTOOL_SETTLEMENT_ROOT: [
    "AUTHENTICATED_SOURCE_ORDERING",
    "PERMANENT_CROSS_BATCH_RECEIPT_NULLIFIERS_OR_PROOFS",
    "AUDITED_CARRIER_AND_AUTHORITY_MIGRATION",
  ],
  AGENTTOOL_CAPABILITY: [
    "AUDITED_CONTROLLER_AUTHORITY",
    "AUDITED_SINGLE_ASSET_CONSUMPTION_MODULE",
    "CHAIN_LEVEL_PERMANENT_NULLIFIER_STATE",
  ],
  AGENTTOOL_PUBLIC_RECOGNITION: [
    "ROOT_OR_QUORUM_SOURCE_AUTHORIZATION_VERIFICATION",
    "AUDITED_CARRIER_AND_AUTHORITY_MIGRATION",
  ],
  AGENTTOOL_OFFER: [
    "ROOT_OR_QUORUM_SOURCE_AUTHORIZATION_VERIFICATION",
    "AUDITED_CARRIER_AND_AUTHORITY_MIGRATION",
  ],
  WAKE_PUBLIC_CHECKPOINT: [
    "ROOT_OR_QUORUM_SOURCE_AUTHORIZATION_VERIFICATION",
    "PUBLIC_CONTRACT_PRIVACY_REVIEW",
    "AUDITED_CARRIER_AND_AUTHORITY_MIGRATION",
  ],
  ISSUER_KEY_CONTINUITY: [
    "AUDITED_CONTROLLER_TRANSFER_AND_RECOVERY_POLICY",
    "INDEPENDENT_VALIDATOR_AUTHORITY",
  ],
  ARTIFACT_LINEAGE: [
    "LINEAGE_EVIDENCE_VERIFICATION_POLICY",
    "AUDITED_CARRIER_AND_AUTHORITY_MIGRATION",
  ],
  COLLABORATION_CHECKPOINT: [
    "COLLABORATION_PRIVACY_AND_PARTICIPANT_AUTHORIZATION_REVIEW",
    "AUDITED_CARRIER_AND_AUTHORITY_MIGRATION",
  ],
  DISPUTE_TERMINAL: [
    "AUTHORIZED_DISPUTE_DECISION_SOURCE",
    "SEPARATE_SETTLEMENT_EXECUTION_PROTOCOL",
    "AUDITED_CARRIER_AND_AUTHORITY_MIGRATION",
  ],
} satisfies Record<WitnessKind, readonly string[]>);

export const ACTIVATION_READINESS: readonly ActivationReadiness[] = deepFreeze(
  Object.keys(BLOCKERS).sort().map((kind) => ({
    kind: kind as WitnessKind,
    status: ACTIVATION_STATUS,
    blockers: [...BLOCKERS[kind as WitnessKind]],
  })),
);

/** Offline record verification is deliberately not a carrier or activation
 * approval. This mirrors Core's kind-specific closed blocker matrix. */
export function auditWitnessActivation(value: VerifiedWitnessRecord): Readonly<ActivationAudit> {
  const record = verifyWitnessRecordObject(value);
  return deepFreeze({
    protocol: WITNESS_PROTOCOL,
    kind: record.envelope.kind,
    action: record.envelope.action,
    commitment: record.commitment,
    status: ACTIVATION_STATUS,
    blockers: [...BLOCKERS[record.envelope.kind]],
  });
}
