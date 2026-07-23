import type {
  AgentDataIdentity,
  BlockStore,
  Cid,
  SignedManifest,
} from "@agenttool/adds";

export const ARCHIVE_PROTOCOL = "agent-repo-archive/v0.1" as const;
export const PACKAGE_NAME = "@agenttool/repo-archive" as const;
export const PACKAGE_VERSION = "0.1.0-dev.0" as const;
export const ARCHIVE_PAYLOAD_FORMAT = "agent-repo-archive-payload/v0.1" as const;
export const ARCHIVE_RECORD_ID_ALGORITHM = "SHA-256" as const;
export const ARCHIVE_SIGNATURE_ALGORITHM = "Ed25519" as const;
export const ARCHIVE_SIGNATURE_ENCODING = "base64url-unpadded" as const;
export const RECOVERY_ENVELOPE_ALGORITHM = "HKDF-SHA256-AES-256-GCM" as const;
export const RECOVERY_ENVELOPE_AAD = "agent-repo-archive/v0.1/recovery-envelope" as const;
export const DEFAULT_ARCHIVE_MAX_BYTES = 64 * 1024 * 1024;
export const DEFAULT_ARCHIVE_CHUNK_SIZE = 4 * 1024 * 1024;
export const DEFAULT_REQUIRED_VERIFIED_ZONES = 3;
export const DEFAULT_GIT_COMMAND_TIMEOUT_MS = 5 * 60 * 1_000;

export type ArchiveRecordKind =
  | "snapshot"
  | "placement"
  | "verification"
  | "catalog";

export type ArchiveHealth = "observed" | "verified" | "degraded" | "incomplete";

export interface ArchiveSigner {
  id: string;
  ed25519_public_key: string;
}

export interface ArchiveSignature {
  algorithm: typeof ARCHIVE_SIGNATURE_ALGORITHM;
  encoding: typeof ARCHIVE_SIGNATURE_ENCODING;
  public_key: string;
  value: string;
}

export interface SignedRecordFields {
  record_id: `sha256:${string}`;
  signature: ArchiveSignature;
}

export interface GitWorkspaceState {
  included: false;
  staged_changes: number;
  tracked_changes: number;
  untracked_files: number;
  unmerged_paths: number;
}

export interface GitSubmoduleState {
  included: false;
  gitlink_evidence_events: number;
}

export interface GitLfsState {
  included: false;
  pointer_evidence_events: number;
}

export interface GitPartialCloneState {
  detected: boolean;
  promised_objects_materialized: false;
}

export interface GitAlternatesState {
  detected: boolean;
  alternate_locations: number;
  objects_materialized: false;
}

export interface GitShallowCloneState {
  detected: boolean;
  complete_history: boolean;
}

export interface GitLinkedWorktreeState {
  included: false;
  additional_worktrees: number;
}

export interface GitExternalFilterState {
  included: false;
  attribute_evidence_events: number;
}

export interface GitCaptureCompleteness {
  status: "complete" | "incomplete";
  committed_history: "included";
  workspace: GitWorkspaceState;
  submodules: GitSubmoduleState;
  lfs: GitLfsState;
  external_filters: GitExternalFilterState;
  shallow_clone: GitShallowCloneState;
  partial_clone: GitPartialCloneState;
  alternates: GitAlternatesState;
  linked_worktrees: GitLinkedWorktreeState;
  ignored_files: {
    included: false;
    assessed: false;
  };
  reasons: string[];
}

export interface GitRepositoryDescriptor {
  repository_id: string;
  object_format: "sha1" | "sha256";
  head_revision: string;
  head_kind: "branch" | "detached";
  branch: string | null;
  symbolic_refs: GitSymbolicRef[];
  refs_digest: `sha256:${string}`;
  refs_count: number;
}

export interface GitSymbolicRef {
  ref: string;
  target: string;
}

export interface SnapshotPayloadDescriptor {
  format: "git-bundle";
  bundle_version: "v2-or-v3";
  digest: `sha256:${string}`;
  bytes: number;
}

export interface ArchiveAuthority {
  automatic_restore: "never";
  execute_repository_code: "never";
  checkout: "explicit_after_restore";
}

export interface SnapshotDescriptorCore {
  protocol: typeof ARCHIVE_PROTOCOL;
  kind: "snapshot";
  signer: ArchiveSigner;
  vault_id: string;
  created_at: string;
  repository: GitRepositoryDescriptor;
  completeness: GitCaptureCompleteness;
  payload: SnapshotPayloadDescriptor;
  parent_snapshot_id: `sha256:${string}` | null;
  authority: ArchiveAuthority;
}

export type SignedSnapshotDescriptor = SnapshotDescriptorCore & SignedRecordFields;

export type ZoneTransport =
  | "filesystem"
  | "s3"
  | "webdav"
  | "ipfs"
  | "other";

export interface ZoneFailureDomain {
  failure_domain_id: string;
  provider: string;
  account_root: string;
  region: string;
  credential_root: string;
  media: string;
}

export interface ZoneDescriptor {
  zone_id: string;
  transport: ZoneTransport;
  locator: string;
  assurance: "simulated" | "operator_asserted" | "provider_evidenced";
  delete_authority: "routine_writer" | "separate_maintenance" | "unknown";
  failure_domain: ZoneFailureDomain;
}

export interface RecoveryKeyEnvelope {
  protocol: typeof ARCHIVE_PROTOCOL;
  kind: "recovery_key_envelope";
  algorithm: typeof RECOVERY_ENVELOPE_ALGORITHM;
  aad: typeof RECOVERY_ENVELOPE_AAD;
  vault_id: string;
  recovery_key_id: string;
  manifest_cid: Cid;
  nonce: string;
  ciphertext: string;
}

export interface PlacementReceiptCore {
  protocol: typeof ARCHIVE_PROTOCOL;
  kind: "placement";
  signer: ArchiveSigner;
  vault_id: string;
  snapshot_id: `sha256:${string}`;
  snapshot_root_cid: Cid;
  zone: ZoneDescriptor;
  result: "observed";
  ciphertext_blocks_observed: number;
  encrypted_bytes_observed: number;
  observed_at: string;
  caveat: "observation_is_not_future_durability";
}

export type SignedPlacementReceipt = PlacementReceiptCore & SignedRecordFields;

export interface VerificationReceiptCore {
  protocol: typeof ARCHIVE_PROTOCOL;
  kind: "verification";
  signer: ArchiveSigner;
  vault_id: string;
  snapshot_id: `sha256:${string}`;
  snapshot_root_cid: Cid;
  zone_id: string;
  method: "full_restore";
  result: "verified";
  ciphertext_blocks_verified: number;
  payload_digest_verified: `sha256:${string}`;
  git_bundle_verified: true;
  git_fsck: "passed";
  checkout_performed: false;
  restored_head: string;
  verified_at: string;
}

export type SignedVerificationReceipt = VerificationReceiptCore & SignedRecordFields;

export interface RecoveryCatalogCore {
  protocol: typeof ARCHIVE_PROTOCOL;
  kind: "catalog";
  signer: ArchiveSigner;
  vault_id: string;
  generation: number;
  parent_catalog_id: `sha256:${string}` | null;
  created_at: string;
  status: ArchiveHealth;
  required_verified_zones: number;
  snapshot_root_cid: Cid;
  snapshot: SignedSnapshotDescriptor;
  snapshot_key_envelope: RecoveryKeyEnvelope;
  zones: ZoneDescriptor[];
  placements: SignedPlacementReceipt[];
  verifications: SignedVerificationReceipt[];
  authority: ArchiveAuthority;
}

export type SignedRecoveryCatalog = RecoveryCatalogCore & SignedRecordFields;

export interface ArchiveZone {
  descriptor: ZoneDescriptor;
  store: BlockStore;
}

/**
 * Local recovery capability. It contains private key material and must never be
 * logged, placed in a replicated catalog, or serialized without an
 * operator-chosen secret-protection layer.
 */
export interface RecoveryCapsule {
  protocol: typeof ARCHIVE_PROTOCOL;
  kind: "recovery_capsule";
  vault_id: string;
  catalog_root_cid: Cid;
  catalog_key_envelope: RecoveryKeyEnvelope;
  recovery_key_id: string;
  recovery_key: Uint8Array;
  created_at: string;
  toJSON(): never;
}

export interface ArchiveRepositoryOptions {
  repositoryPath: string;
  repositoryId?: string;
  vaultId?: string;
  zones: readonly ArchiveZone[];
  publisherIdentity: AgentDataIdentity;
  recoveryKey?: Uint8Array;
  recoveryKeyId?: string;
  now?: Date | string | number;
  allowIncomplete?: boolean;
  requiredVerifiedZones?: number;
  maxBytes?: number;
  chunkSize?: number;
  parentSnapshotId?: `sha256:${string}` | null;
}

export interface ArchivedRepository {
  snapshot: SignedSnapshotDescriptor;
  snapshotRootCid: Cid;
  snapshotManifest: SignedManifest;
  placements: SignedPlacementReceipt[];
  verifications: SignedVerificationReceipt[];
  catalog: SignedRecoveryCatalog;
  catalogRootCid: Cid;
  catalogManifest: SignedManifest;
  recoveryCapsule: RecoveryCapsule;
  outcome: ArchiveRepositoryOutcome;
}

export interface ArchiveRepositoryOutcome {
  policy_satisfied: boolean;
  recovery_verified_zone_ids: string[];
  snapshot_failed_zone_ids: string[];
  catalog_failed_zone_ids: string[];
}

export interface RestoreRepositoryOptions {
  zone: ArchiveZone;
  recoveryCapsule: RecoveryCapsule;
  targetPath: string;
  maxBytes?: number;
  expectedSnapshotId?: `sha256:${string}`;
}

export interface RestoreResult {
  zone_id: string;
  snapshot_id: `sha256:${string}`;
  catalog_id: `sha256:${string}`;
  target_path: string;
  restored_head: string;
  checkout_performed: false;
  git_bundle_verified: true;
  git_fsck: "passed";
}

export interface GitCapture {
  repository: GitRepositoryDescriptor;
  completeness: GitCaptureCompleteness;
  bundle: Uint8Array;
  payload: SnapshotPayloadDescriptor;
}

export interface GitRestoreResult {
  targetPath: string;
  restoredHead: string;
}

export interface SimulatorZoneResult {
  zone_id: string;
  snapshot_status: "verified";
  catalog_status: ArchiveHealth;
  restored_head: string;
}

export interface SimulatorResult {
  protocol: typeof ARCHIVE_PROTOCOL;
  mode: "same-device-three-zone-simulation";
  durability_claim: "none";
  snapshot_id: `sha256:${string}`;
  catalog_id: `sha256:${string}`;
  snapshot_root_cid: Cid;
  catalog_root_cid: Cid;
  capture_status: "complete" | "incomplete";
  zones: SimulatorZoneResult[];
}
