export {
  ALLOWED_ACTIONS,
  AGENTTOOL_SOURCE_HASH_PROTOCOL,
  COLLABORATION_PARTICIPANT_HMAC_PROTOCOL,
  HASH_DOMAINS,
  LIMITS,
  MAX_UINT64,
  OFFLINE_AUDIENCE,
  PACKAGE_NAME,
  PACKAGE_VERSION,
  PUBLIC_OFFER_BOUNDARIES,
  PUBLIC_WAKE_CONTRACT_BOUNDARIES,
  PUBLIC_WAKE_WITHDRAWAL_BOUNDARIES,
  REQUIRED_NONCLAIMS,
  SETTLEMENT_LEAF_BOUNDARIES,
  SOURCE_SCHEMAS,
  WITNESS_ACTIONS,
  WITNESS_CANONICAL_LIMITS,
  WITNESS_KINDS,
  WITNESS_PROTOCOL,
  ZERO_EFFECTS,
} from "./constants.js";

export {
  ACTIVATION_READINESS,
  ACTIVATION_STATUS,
  auditWitnessActivation,
} from "./activation.js";

export {
  WitnessProjectionError,
  type WitnessProjectionErrorCode,
} from "./errors.js";

export {
  agentToolSourceHash,
  agentToolSourceHashBytes,
  bytesToHex,
  canonicalSha256,
  concatBytes,
  ed25519Fingerprint,
  hexToBytes,
  opaqueScopedRef,
  scopedHash,
  scopedHashBytes,
  sha256Bytes,
  sha256Hex,
  sha256Id,
} from "./hash.js";

export {
  RFC6962_MERKLE_ALGORITHM,
  SETTLEMENT_LEAF_DOMAIN,
  rfc6962InclusionProof,
  rfc6962LeafHash,
  rfc6962LeafHashHex,
  rfc6962DomainLeafHash,
  rfc6962DomainMerkleRoot,
  rfc6962DomainMerkleRootHex,
  rfc6962MerkleRoot,
  rfc6962MerkleRootHex,
  rfc6962NodeHash,
  verifyRfc6962Inclusion,
} from "./merkle.js";

export {
  decodeWitnessCanonicalJson,
  encodeWitnessCanonicalJson,
  snapshotWitnessBytes,
  snapshotWitnessJsonData,
  witnessCanonicalJson,
  type WitnessJsonPrimitive,
  type WitnessJsonValue,
} from "./witness-canonical.js";

export {
  assertPublicWakeSuccessor,
  assertVerifiedPublicWakeContract,
  publicWakeContractDigest,
  publicWakeContractId,
  publicWakeWithdrawalDigest,
  publicWakeWithdrawalId,
  sealPublicWakeContract,
  sealPublicWakeWithdrawal,
  validatePublicWakeContract,
  validatePublicWakeContractCore,
  validatePublicWakeWithdrawal,
  validatePublicWakeWithdrawalCore,
  validateSingleKeyControlAuthority,
  verifyPublicWakeContract,
  verifyPublicWakeContractSignature,
  verifyPublicWakeWithdrawal,
  verifyPublicWakeWithdrawalForContract,
  verifyPublicWakeWithdrawalSignature,
} from "./public-wake.js";

export {
  assertPublicOfferSuccessor,
  projectPublicOfferPublish,
  projectPublicOfferRevoke,
  projectPublicOfferSupersede,
  publicOfferDigest,
  publicOfferId,
  sealPublicOffer,
  validatePublicOffer,
  validatePublicOfferCore,
  verifyPublicOffer,
  verifyPublicOfferSignature,
} from "./public-offer.js";

export {
  SETTLEMENT_ACTIVATION_BOUNDARY,
  SETTLEMENT_MERKLE_PROFILE,
  SETTLEMENT_RECEIPT_FIELDS,
  SETTLEMENT_RECEIPT_PROTOCOL,
  SETTLEMENT_RECEIPT_SCHEMA_DESCRIPTOR,
  SETTLEMENT_RECEIPT_SCHEMA_DIGEST,
  canonicalSettlementReceiptDigest,
  createSettlementBatchProjection,
  createSettlementLeaf,
  validateSettlementReceiptSource,
  type SettlementBatchInput,
} from "./settlement.js";

export {
  verifySettlementBatchSidecarBytes,
  verifySettlementBatchSidecarObject,
} from "./settlement-sidecar.js";

export {
  assetRef,
  capabilityConsumeNullifier,
  capabilityRef,
  projectCapabilityConsume,
  projectCapabilityGrant,
  projectCapabilityRevoke,
  type CapabilityConsumeInput,
  type CapabilityRevokeInput,
} from "./capability.js";

export {
  projectPublicRecognitionAdoption,
  projectPublicRecognitionWithdrawal,
  recognitionRef,
  type PublicRecognitionWithdrawalInput,
} from "./recognition.js";

export {
  collaborationEventHash,
  projectCollaborationCheckpoint,
  type CollaborationCheckpointInput,
} from "./collaboration.js";

export {
  projectPublicWakeCheckpoint,
  projectPublicWakeSupersede,
  projectPublicWakeWithdrawal,
} from "./wake-projection.js";

export {
  PUBLIC_OFFER_SCHEMA,
  PUBLIC_OFFER_SCHEMA_DIGEST,
  PUBLIC_WAKE_CONTRACT_SCHEMA,
  PUBLIC_WAKE_CONTRACT_SCHEMA_DIGEST,
  PUBLIC_WAKE_WITHDRAWAL_SCHEMA,
  PUBLIC_WAKE_WITHDRAWAL_SCHEMA_DIGEST,
} from "./source-schemas.js";

export {
  EXPECTED_SCHEMA_HASHES,
  SETTLEMENT_BATCH_SIDECAR_SCHEMA,
  SHARED_PAYLOAD_SCHEMAS,
  WITNESS_RECORD_SCHEMA,
} from "./shared-schemas.js";

export {
  createWitnessRecord,
  verifyWitnessRecordBytes,
  verifyWitnessRecordObject,
  witnessCommitment,
  witnessPayloadRoot,
  type CreateWitnessRecordInput,
} from "./witness-record.js";

export {
  assertSignatureFingerprint,
  signHexEd25519Digest,
  validateHexEd25519Signature,
  verifyHexEd25519Digest,
  validateHexEd25519Signer,
} from "./signature.js";

export type * from "./types.js";
