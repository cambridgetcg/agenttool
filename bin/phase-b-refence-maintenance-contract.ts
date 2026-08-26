type Row = Record<string, any>;

export const CONTRACT_SCHEMA =
  "agenttool-phase-b-refence-maintenance-contract/v1" as const;

export interface ContractPrimitives {
  canonical(value: unknown): string;
  digest(value: string): string;
  refuse(code: string): never;
}

export interface ContractEvidence {
  edge: string;
  runID: string;
  receiptSHA256: string;
  receipt: {
    prior_audited_lineage: {
      protected_main_revision: string;
      protected_main_tree: string;
      clean_526_ancestor_distance: number;
      evidence_only: boolean;
      readmission_authority: boolean;
    };
    terminal_fleet_sha256: string;
  };
  sourceRevision: string;
  sourceTree: string;
  targetRevision: string;
  targetTree: string;
  targetDistance: number;
  sourceInventorySHA256: string;
  journalInventorySHA256: string;
  cronSHA256: string;
  roles: {
    app_lhr: [string, string];
    app_cdg: string;
    thinker_primary: string;
    thinker_standby: string;
  };
  imageContract: {
    fullImageRefSha256: string;
    configImage: string;
    digest: string;
    tag: string;
  };
  fencedConfigSHA256ByMachine: Record<string, string>;
  restoredConfigSHA256ByMachine: Record<string, string>;
  deployReceiptFileCount: number;
  producerAdmission: { embeddedCriticalContractSHA256: string };
  producerTerminalProof: {
    journalSHA256: string;
    drainSampleSHA256: string;
    drainEventSHA256s: [string, string, string];
  };
}

export interface TargetImageContract {
  tag: string;
  digest: string;
  revision: string;
}

export interface TargetFleetExpectation {
  targetImageMachineIDs: readonly string[];
  restartRestoredMachineIDs: readonly string[];
  autostartEnabledAppMachineIDs: readonly string[];
  startedMachineIDs: readonly string[];
  uncordonedAppMachineIDs: readonly string[];
}

export type FlyOperation =
  | { kind: "build_push"; imageTag: string; revision: string }
  | { kind: "update_image"; machineID: string; imageReference: string }
  | { kind: "restore_app"; machineID: string }
  | { kind: "enable_autostart"; machineID: string }
  | { kind: "restore_primary"; machineID: string }
  | { kind: "restore_standby"; machineID: string; primaryID: string }
  | { kind: "start"; machineID: string }
  | { kind: "wait_started"; machineID: string }
  | { kind: "cordon"; machineID: string }
  | { kind: "uncordon"; machineID: string }
  | { kind: "refence_app"; machineID: string }
  | { kind: "refence_primary"; machineID: string }
  | { kind: "refence_standby"; machineID: string }
  | { kind: "stop"; machineID: string }
  | { kind: "list" }
  | { kind: "secrets" };

export interface FleetTransitionProof {
  image: TargetImageContract | null;
  before_first_fleet_sha256: string;
  before_second_fleet_sha256: string;
  first_fleet_sha256: string;
  second_fleet_sha256: string;
  stable_fleet_sha256: string;
  non_image_config_sha256: string;
  touched_machine_id: string | null;
}

export interface StoppedFleetProof {
  fingerprint: string;
  nonImageConfigSHA256: string;
}

export interface DatabaseProof {
  source_inventory_sha256: string;
  journal_file_count: number;
  journal_endpoint_count: 2;
  journal_observation_count: 4;
  journal_inventory_sha256: string;
  target_migration_applied_at: [string, string];
  migration_definitions_verified: boolean;
  migration_data_verified: boolean;
  remainder_affected_count: number;
  federation_disabled: boolean;
  federation_instance_url_sha256: string;
  federation_updated_at: string;
  durable_hold: boolean;
  allowed_origins_count: number;
  reserved_generation_rows: number;
  authoritative_v2_rows: number;
  received_v1_rows: number;
  drain_sample_count: 3;
  drain_informational: { payout_requested: number; x402_inserted: number };
  drain_zero: boolean;
  cron_sha256: string;
  database_target_sha256: string;
  producer_authority: {
    source_migrations: Array<{ filename: string; checksum: string }>;
    terminal_journal: {
      transaction: {
        rows: Array<{ filename: string; checksum: string; applied_at: string }>;
        targetAppliedAt: [string, string];
      };
      session: {
        rows: Array<{ filename: string; checksum: string; applied_at: string }>;
        targetAppliedAt: [string, string];
      };
    };
    terminal_drain_snapshots: Array<{
      counts: Record<string, number>;
      informational: { payout_requested: number; x402_inserted: number };
      cron_sha256: string;
    }>;
  };
}

export interface DatabaseOriginConvergenceProof {
  schema: "agenttool-phase-b-refence-database-origin-convergence/v1";
  statement_sha256: string;
  database_target_sha256: string;
  before_row_sha256: string;
  after_row_sha256: string;
  unchanged_projection_sha256: string;
  delta_sha256: string;
  before_instance_url_sha256: string;
  after_instance_url_sha256: string;
  before_updated_at: string;
  after_updated_at: string;
  clock_before: string;
  clock_after: string;
  database_write_attempt_count: 1;
  rows_updated: 1;
  commit_acknowledged: true;
  commit_ambiguity: false;
  rollback_attempt_count: 0;
}

export interface ControllerWalContractEntry extends Row {
  schema: "agenttool-phase-b-refence-maintenance-child-wal/v1";
  ordinal: number;
  prior_entry_sha256: string | null;
  controller_run_id: string;
  rollout_id: string;
  receipt_sha256: string;
  recorded_at: string;
  phase: string;
  checkpoint: string;
  effect_id: string | null;
  effect_kind: string | null;
  target: string | null;
  argv_sha256: string | null;
  pid: number | null;
  pgid: number | null;
  exit_code: number | null;
  termination: string | null;
  local_process_group_settled: boolean;
  provider_transition_sha256: string | null;
  fleet_readback_sha256: string | null;
  detail_sha256: string | null;
  failure_code: string | null;
}

export interface PublicJsonObservation {
  body: unknown;
  bodyByteCount: number;
  bodySha256: string;
  cacheControl: string | null;
  contentType: string;
  finalURL: string;
  observationStartedAtUnixMs: number;
  observationSettledAtUnixMs: number;
  redirected: false;
  status: 200;
}

export interface PublicGateEvent {
  kind: string;
  proof_sha256: string | null;
  milliseconds: number | null;
}

export interface FirstCanaryPublicProof {
  schema: "agenttool-phase-b-refence-first-canary-public/v1";
  checkpoint: "first_canary";
  target_revision: string;
  authority_state: "absent_fail_closed";
  federation_instance_url_sha256: string;
  stable_fleet_sha256: string;
  fleet_sample_count: 2;
  fleet_before_after_equal: true;
  public_round_count: 3;
  public_observation_count: 6;
  pause_count: 2;
  pause_milliseconds: 2_000;
  health_projection_sha256: string;
  federation_about_projection_sha256: string;
  public_contract_projection_all_rounds_equal: true;
  public_sandwich_sha256: string;
  verified: true;
}

export interface FinalPublicProof {
  schema: "agenttool-phase-b-refence-final-public/v1";
  checkpoint: "final";
  target_revision: string;
  authority_state: "absent_fail_closed";
  federation_instance_url_sha256: string;
  health_projection_sha256: string;
  federation_about_projection_sha256: string;
  public_contract_projection_before_after_equal: true;
  public_observation_count: 4;
  verified: true;
}

export interface FinalAuthorityProof {
  schema: "agenttool-phase-b-refence-final-authority/v1";
  checkpoint: "final";
  target_revision: string;
  target_tree: string;
  authority_state: "absent_fail_closed";
  authority_pair_count: 8;
  authority_sandwich_sha256: string;
  local_evidence_sha256: string;
  git_proof_sha256: string;
  keychain_proof_sha256: string;
  provider_inventory_sha256: string;
  process_proof_sha256: string;
  stable_fleet_sha256: string;
  public_proof_sha256: string;
  database_observation_count: 1;
  database_proof_sha256: string;
  database_instance_url_sha256: string;
  database_federation_updated_at: string;
  database_target_sha256: string;
  verified: true;
}

export interface FinalAuthorityResult {
  publicProof: FinalPublicProof;
  authorityProof: FinalAuthorityProof;
}

export interface FirstCanaryPublicCoreRequest {
  evidence: ContractEvidence;
  expectation: TargetFleetExpectation;
  expectedFleetSHA256: string;
  dependencies: {
    readFleetProof(): Promise<string>;
    readPublicJson(
      url: string,
      checkpoint: string,
    ): Promise<PublicJsonObservation>;
    pause(milliseconds: number): Promise<void>;
  };
}

export interface FinalAuthorityCoreRequest {
  evidence: ContractEvidence;
  expectation: TargetFleetExpectation;
  expectedFleetSHA256: string;
  expectedDatabaseUpdatedAt: string;
  dependencies: {
    readEvidenceProof(): Promise<string>;
    readGitProof(): Promise<string>;
    readKeychainProof(): Promise<string>;
    readProviderProof(): Promise<string>;
    readProcessProof(checkpoint: string): Promise<string>;
    readFleetProof(): Promise<string>;
    readPublicJson(
      url: string,
      checkpoint: string,
    ): Promise<PublicJsonObservation>;
    readDatabaseProof(): Promise<{
      proofSHA256: string;
      instanceURLSHA256: string;
      updatedAt: string;
      targetSHA256: string;
    }>;
  };
}

export interface StoppedFenceCoreRequest {
  checkpoint: "post_build" | "recovery_terminal";
  receiptSHA256: string;
  targetRevision: string;
  targetTree: string;
  expectedDatabaseUpdatedAt: string;
  expectedFleetSHA256: string;
  image: TargetImageContract | null;
  expectation: TargetFleetExpectation;
  dependencies: {
    readEvidenceProof(): Promise<{
      evidence: ContractEvidence;
      fingerprint: string;
    }>;
    readGitProof(): Promise<Row>;
    readDatabaseProof(): Promise<DatabaseProof>;
    readProviderProof(): Promise<string>;
    readKeychainProof(): Promise<Row>;
    readProcessProof(): Promise<Row>;
    readFleetProof(): Promise<string>;
    pause(milliseconds: number): Promise<void>;
  };
}

export interface CordonedRuntimeCoreRequest {
  evidence: ContractEvidence;
  image: TargetImageContract;
  expectation: TargetFleetExpectation;
  expectedFleetSHA256: string;
  startedMachineIDs: readonly string[];
  dependencies: {
    readFleetProof(): Promise<string>;
    runMachineProbe(
      machineID: string,
      role: "app" | "thinker_primary",
    ): Promise<string>;
    pause(milliseconds: number): Promise<void>;
  };
}

export interface SuccessArchiveBinding {
  path: string;
  sha256: string;
  device: number;
  inode: number;
  nlink: 1;
}

export interface SuccessAuthorityProjection extends Row {
  schema: "agenttool-phase-b-refence-maintenance-success-authority/v1";
  success_proven_at: string;
  controller_run_id: string;
  rollout_id: string;
  refence_receipt_sha256: string;
  source_revision: string;
  source_tree: string;
  marker_authority_sha256: string;
  database_convergence_sha256: string;
  deploy_lock_sha256: string;
  build_context_sha256: string;
  dependency_estate_sha256: string;
  refence_handoff_sha256: string;
  retained_archives: {
    anchor: SuccessArchiveBinding;
    witness: SuccessArchiveBinding;
  };
  controller_wal: Row;
  rollout_proofs: Row;
  final_truth: Row;
}

export interface SuccessAuthorityRequest {
  successProvenAt: string;
  controllerRunID: string;
  rolloutID: string;
  refenceReceiptSHA256: string;
  sourceRevision: string;
  sourceTree: string;
  roles: ContractEvidence["roles"];
  marker: Row;
  databaseConvergence: Row;
  deployLock: Row;
  deployLockSHA256: string;
  earlyGuardSHA256: string;
  buildContext: Row;
  dependencyEstate: Row;
  refenceHandoff: Row;
  retainedArchives: SuccessAuthorityProjection["retained_archives"];
  controllerWal: Row;
  rolloutProofs: Row;
  finalTruth: Row;
}

export interface SuccessArtifactRequest {
  authorityRequest: SuccessAuthorityRequest;
  authorityProjection: SuccessAuthorityProjection;
  markerPath: string;
  markerBytesUTF8: string;
  receiptPath: string;
  witnessPath: string;
  markerRetirementClaimPath: string;
  lockPublicPath: string;
  lockOwnerPath: string;
  lockDevice: string;
  lockInode: string;
  lockSHA256: string;
}

export interface SuccessArtifactBundle {
  authorityProjection: SuccessAuthorityProjection;
  authorityProjectionSHA256: string;
  markerBytesUTF8: string;
  markerSHA256: string;
  witness: Row;
  witnessBytesUTF8: string;
  witnessSHA256: string;
  receipt: Row;
  receiptBytesUTF8: string;
  receiptSHA256: string;
}

export interface SuccessFinalizationPreviewRequest {
  currentMarker: Row;
  successProvenAt: string;
  walProjection: Row;
  authorityProjectionSHA256: string;
  receiptPath: string;
  witnessPath: string;
  markerRetirementClaimPath: string;
}

export interface ProducerAuthorityProjection {
  schema: "agenttool-phase-b-refence-producer-authority/v1";
  caveats_sha256: string;
  recovery_capsule_path: string;
  recovery_capsule_sha256: string;
  wal_entry_count: number;
  first_wal_sha256: string;
  terminal_wal_sha256: string;
  prior_lineage_sha256: string;
  lock_sha256: string;
  context_sha256: string;
  admission_sha256: string;
  anchor_sha256: string;
  witness_sha256: string;
  armed_wal_ordinal: number;
  armed_wal_sha256: string;
}

export interface ProducerAuthorityRequest {
  receipt: Row;
  walRecords: readonly {
    value: Row;
    sha256: string;
    filename: string;
  }[];
  anchor: { value: Row; sha256: string };
  witness: { value: Row; sha256: string };
}

export interface ProducerCriticalStaticContract {
  migrationAppliedAt: readonly [string, string];
  constraintDefinitions: Readonly<
    Record<string, readonly [string, string]>
  >;
  holdColumnComment: string;
  remainderColumnComment: string;
  generationFunctionProsrcSHA256: string;
  cronSHA256: string;
  zeroFields: readonly string[];
  machineSetSHA256: string;
  restoredConfigSHA256ByRole: Readonly<{
    app_lhr_1: string;
    app_lhr_2: string;
    app_cdg: string;
    thinker_primary: string;
    thinker_standby: string;
  }>;
}

export interface MaintenanceContract {
  schema: typeof CONTRACT_SCHEMA;
  databaseOriginContract: Readonly<{
    schema: string;
    transaction_mode: string;
    transaction_statements: readonly string[];
    lock_sql: string;
    update_sql: string;
    parameter_order: readonly string[];
    update_column_set: readonly string[];
    client: Readonly<Record<string, unknown>>;
    outer_destructive_deadline_milliseconds: number;
  }>;
  maintenanceDatabaseProofSQL: string;
  controllerFlyArgv(operation: FlyOperation, pinnedFly: string): string[];
  controllerOperationContract(operation: FlyOperation): Readonly<{
    effectKind: string;
    target: string;
    timeoutMilliseconds: number;
  }>;
  parseFleetChildOutput(bytes: Uint8Array): unknown[];
  expectedOrdinaryAbsentPostflightBytes(targetRevision: string): string;
  parsePublicObservation(bytes: Uint8Array): PublicJsonObservation;
  validateTargetFleetExpectation(
    evidence: ContractEvidence,
    expectation: TargetFleetExpectation,
  ): void;
  validateStoppedFleet(
    raw: unknown,
    evidence: ContractEvidence,
  ): StoppedFleetProof;
  producerCriticalContractSHA256(
    source: readonly { filename: string; checksum: string }[],
    evidence: ContractEvidence,
    staticContract: ProducerCriticalStaticContract,
  ): string;
  producerLocalStateSandwichSHA256(request: {
    anchorSHA256: string;
    firstWalSHA256: string;
    firstWalOrdinal: number;
    deployReceiptInventorySHA256: string;
    deployReceiptFileCount: number;
  }): string;
  validateProducerLocalStateSandwich(
    request: {
      anchorSHA256: string;
      firstWalSHA256: string;
      firstWalOrdinal: number;
      deployReceiptInventorySHA256: string;
      deployReceiptFileCount: number;
    },
    claimedSHA256: string,
  ): string;
  validateProducerEarlyRuntimeBindings(request: {
    evidence: ContractEvidence;
    databaseProof: DatabaseProof;
    firstFleet: StoppedFleetProof;
    secondFleet: StoppedFleetProof;
    staticContract: ProducerCriticalStaticContract;
  }): string;
  validateDatabaseConvergenceMarker(value: unknown): void;
  validateDatabaseConvergenceTransition(current: unknown, next: unknown): void;
  validateDatabaseOriginConvergence(
    proof: DatabaseOriginConvergenceProof,
    before: DatabaseProof,
    after: DatabaseProof,
  ): { beforeProofSHA256: string; afterProofSHA256: string };
  validateDatabaseProof(
    raw: unknown,
    evidence: ContractEvidence,
    expectedOrigin: { instanceURLSHA256: string; updatedAt: string },
  ): DatabaseProof;
  validateDatabaseConvergenceInheritedProof(raw: unknown): DatabaseProof;
  validateControllerWalEntry(
    value: ControllerWalContractEntry,
    previous: ControllerWalContractEntry | null,
    history: readonly ControllerWalContractEntry[],
    expected: {
      controllerRunID: string;
      rolloutID: string;
      receiptSHA256: string;
    },
  ): void;
  validateVerifiedDatabaseConvergence(request: {
    marker: unknown;
    result: {
      proof: DatabaseOriginConvergenceProof;
      beforeProofSHA256: string;
      afterProofSHA256: string;
    };
    intent: ControllerWalContractEntry | null;
    commit: ControllerWalContractEntry | null;
    verified: ControllerWalContractEntry | null;
    lastEntry: ControllerWalContractEntry | null;
  }): string;
  validateTargetFleet(
    raw: unknown,
    evidence: ContractEvidence,
    image: TargetImageContract,
    expectation: TargetFleetExpectation,
  ): string;
  validateFleetTransition(request: {
    beforeFirst: unknown;
    beforeSecond: unknown;
    first: unknown;
    second: unknown;
    evidence: ContractEvidence;
    operation: FlyOperation;
    image: TargetImageContract | null;
    expectation: TargetFleetExpectation;
  }): FleetTransitionProof;
  validatePublicHealth(
    observation: PublicJsonObservation,
    targetRevision: string,
  ): string;
  validatePublicFederationAbout(observation: PublicJsonObservation): string;
  validateFirstCanaryPublic(request: {
    targetRevision: string;
    events: readonly PublicGateEvent[];
  }): FirstCanaryPublicProof;
  runFirstCanaryPublicCore(
    request: FirstCanaryPublicCoreRequest,
  ): Promise<FirstCanaryPublicProof>;
  validateFinalAuthority(request: {
    targetRevision: string;
    targetTree: string;
    expectedDatabaseUpdatedAt: string;
    databaseInstanceURLSHA256: string;
    databaseUpdatedAt: string;
    databaseTargetSHA256: string;
    events: readonly PublicGateEvent[];
  }): FinalAuthorityResult;
  runFinalAuthorityCore(request: FinalAuthorityCoreRequest): Promise<{
    publicProofSHA256: string;
    authorityProofSHA256: string;
  }>;
  runStoppedFenceCore(request: StoppedFenceCoreRequest): Promise<Row>;
  runCordonedRuntimeCore(request: CordonedRuntimeCoreRequest): Promise<Row>;
  createSuccessAuthorityProjection(
    request: SuccessAuthorityRequest,
  ): SuccessAuthorityProjection;
  createSuccessArtifacts(
    request: SuccessArtifactRequest,
  ): SuccessArtifactBundle;
  validateSuccessArtifactBundle(bundle: SuccessArtifactBundle): void;
  previewSuccessFinalizationMarker(
    request: SuccessFinalizationPreviewRequest,
  ): Row;
  bridgeMarkerSuccessAuthorityProjection(value: Row): Row;
  validateBridgeMarkerTransition(current: Row, next: Row): void;
  applyRecoveryMarkerTransition(
    value: Row,
    operation: FlyOperation,
    roles: ContractEvidence["roles"],
    recoveryActive: boolean,
  ): void;
  validateProducerAuthorityProjection(
    request: ProducerAuthorityRequest,
  ): ProducerAuthorityProjection;
  refenceOperatorDeclarationValues(
    text: string,
    declarations: readonly (readonly [string, string, string])[],
  ): Record<string, string>;
  refenceOperatorImmutableCaveats(text: string): readonly string[];
  normalizedRefenceOperator(
    text: string,
    declarations: readonly (readonly [string, string, string])[],
  ): string;
  normalizedFullAudit(text: string): string;
  expectedAuditWitness(targetDistance: number): Row;
  validateFlyAuthenticationConfigText(text: string): void;
}

const TARGET_INSTANCE_URL = "https://api.agenttool.dev";
const PUBLIC_HEALTH_URL = "https://api.agenttool.dev/health";
const PUBLIC_ABOUT_URL = "https://api.agenttool.dev/federation/about";
const MAX_PUBLIC_BODY_BYTES = 500_000;
const MAX_PUBLIC_OBSERVATION_BYTES = 1_500_000;
const WELCOME_CLOCK_SKEW_MILLISECONDS = 8_000;
const FENCED_SOURCE_REVISION = "526edc4ee0d076783d157591d7e3434352f6fc84";
const FENCED_IMAGE_TAG =
  "maintenance-526edc4ee0d0-20260824T210704Z-6e9e59cc185245bc";
const FENCED_IMAGE_DIGEST =
  "sha256:ecb322baec96707f59603121cfd4613d08ff7b1da8bf338fa118453b45d3e72c";
const GENERATION_PROVIDER_SECRET = "AGENTTOOL_COVENANT_V2_AUTHORITY_GENERATION";
const PRE_REFENCE_INSTANCE_URL_SHA256 =
  "46b695dffb312f6591e480ec5882d894e1b5e1efdb3bfc05da6303f9259ba818";
const TARGET_INSTANCE_URL_SHA256 =
  "beb8e35af063f5f2619474d6af1757bca1b0cddc801842d39cdf0bb1ada8f37d";
const EXPECTED_FEDERATION_UPDATED_AT = "2026-08-21T18:49:13.745704Z";
const EXPECTED_MIGRATION_APPLIED_AT = Object.freeze([
  "2026-08-24T21:02:16.132506Z",
  "2026-08-24T21:02:16.520915Z",
]);
const EXPECTED_JOURNAL_FILE_COUNT = 177;
const EXPECTED_CRON_SHA256 =
  "22c6d715e02a1127fe73e743d41694bbe85aaa2bb3674a77703cdb469546fc34";
const PRODUCER_ZERO_DRAIN_FIELDS = Object.freeze([
  "runtime_cycle_leases",
  "llm_unresolved_runtime",
  "llm_unresolved_unbound",
  "deposit_leases_live",
  "deposit_leases_expired",
  "deposit_leases_malformed",
  "deposit_pending",
  "covenant_declaration_in_flight",
  "covenant_lifecycle_in_flight",
  "x402_pending_unattempted",
  "x402_pending_attempted",
  "x402_externally_settled",
  "payout_broadcasting",
  "payout_broadcast",
  "collab_slots_live",
  "collab_slots_expired",
  "collab_slots_recovery",
  "collab_runs_claimed",
  "collab_runs_executing",
  "collab_runs_ambiguous",
  "advisory_locks",
  "lock_waiters",
  "other_nonidle",
  "other_open_transactions",
  "prepared_transactions",
  "cron_running",
  "pg_net_queued",
  "reserved_generation_rows",
  "authoritative_v2_rows",
  "received_v1_rows",
]);
const PRODUCER_STABLE_FLEET_INTERVAL_MILLISECONDS = 1_137;
const PRODUCER_STABLE_DRAIN_INTERVAL_MILLISECONDS = 5_137;
const PRODUCER_TERMINAL_AUTHORITY_SHA256 =
  "e4f7bc0756d7075fa50d129455fcde637a177ddf23647a69554f7f2864ef7c55";
const PRODUCER_TERMINAL_PROVIDER_ABSENCE_SHA256 =
  "888214699cb6a9eab515d75f2e3e7f152d43cc6f60c67d2ddc378637257f982f";
const PRODUCER_IMMUTABLE_CAVEATS = Object.freeze(
  [
    "The clean-526 rollout actor, argv, path, and causal receipt remain unknown.",
    "This operator does not bind or adopt the historical rollout lineage.",
    "Journal timestamps do not attribute either protected migration to this operator or a named process.",
    "Application-time quiescence was not observed and is not proved.",
    "Three spaced zero-drain samples do not prove continuous quiescence.",
    "Provider observations are non-atomic and do not establish a fleet-wide provider lock.",
    "Machine IDs are continuity selectors, not proof of physical identity.",
    "Final recovery does not query Keychain; post-fence Keychain absence remains unknown.",
    "The retained maintenance anchor and mutation-active witness block every wrapper until the separately pinned protected-main readmission guard archives both under lock.",
    "The mutation-active witness is independent of the anchor and WAL root; loss of either core artifact after arming never authorizes no-WAL lock retirement.",
    "SIGKILL after the armed WAL entry is durable but before the mutation-active witness is durably published is a permanent manual-review block; no mutation child was authorized, and resume never synthesizes the missing witness.",
    "SIGKILL between a durable intent and durable child identity is a permanent manual-review block.",
    "A lone unpublished deploy-lock owner inode, or a WAL directory/stage without its first hash-named entry, is a permanent manual-review block; no mutation was authorized.",
    "If local retirement completes without interruption, an exact canonical deploy.lock with no maintenance anchor, mutation-active witness, WAL root, or receipt is safely retired only after two-sample dead-owner proof under a recovery claim; no mutation was authorized, and a later fresh attempt may retry.",
    "SIGKILL after canonical no-WAL deploy.lock absence is durably fsynced but before its recovery-claim chain is fully retired is a permanent manual-review block; no mutation was authorized.",
    "A blocked armed pre-terminal run retains its 0600 recovery capsule indefinitely for exact manual recovery; secret bytes never enter the anchor, public WAL projection, or terminal receipt.",
  ] as const,
);
const PRODUCER_NORMALIZATION_CONTRACT = Object.freeze({
  schema: "agenttool-phase-b-refence-observed-526-normalization/v1",
  algorithm: "unique_exact_declaration_replacement_then_sha256",
  paths_normalized: false,
  code_normalized: false,
  unique_occurrence_required: true,
  declarations: Object.freeze([
    Object.freeze({
      name: "OPERATOR_NORMALIZED_SHA256",
      replacement_token: "__OPERATOR_SELF_NORMALIZED_SHA256__",
      receipt_binding: "operator_normalized_sha256",
    }),
    Object.freeze({
      name: "HARNESS_SHA256",
      replacement_token: "__OPERATOR_HARNESS_SHA256__",
      receipt_binding: "operator_harness_sha256",
    }),
    Object.freeze({
      name: "FULL_AUDIT_SHA256",
      replacement_token: "__FULL_AUDIT_RAW_SHA256__",
      receipt_binding: "audit_evidence.source_sha256",
    }),
    Object.freeze({
      name: "FULL_AUDIT_NORMALIZED_SHA256",
      replacement_token: "__FULL_AUDIT_NORMALIZED_SHA256__",
      receipt_binding: "audit_evidence.source_normalized_sha256",
    }),
    Object.freeze({
      name: "FULL_AUDIT_HARNESS_SHA256",
      replacement_token: "__FULL_AUDIT_HARNESS_SHA256__",
      receipt_binding: "audit_evidence.harness_sha256",
    }),
    Object.freeze({
      name: "FULL_AUDIT_WITNESS_SHA256",
      replacement_token: "__FULL_AUDIT_WITNESS_SHA256__",
      receipt_binding: "audit_evidence.witness_sha256",
    }),
    Object.freeze({
      name: "READMISSION_BRIDGE_REVISION",
      replacement_token: "__READMISSION_BRIDGE_REVISION__",
      receipt_binding: "readmission_target.protected_main_revision",
    }),
    Object.freeze({
      name: "READMISSION_BRIDGE_TREE",
      replacement_token: "__READMISSION_BRIDGE_TREE__",
      receipt_binding: "readmission_target.protected_main_tree",
    }),
    Object.freeze({
      name: "READMISSION_BRIDGE_DISTANCE_PIN",
      replacement_token: "__READMISSION_BRIDGE_DISTANCE__",
      receipt_binding: "readmission_target.clean_526_ancestor_distance",
    }),
    Object.freeze({
      name: "READMISSION_GUARD_NORMALIZED_SHA256",
      replacement_token: "__READMISSION_GUARD_NORMALIZED_SHA256__",
      receipt_binding: "readmission_guard_normalized_sha256",
    }),
  ]),
});
const PRODUCER_SAFE_FAILURE_CODES = Object.freeze(
  [
    "admission_refused",
    "child_refused",
    "database_refused",
    "fleet_refused",
    "interrupted_sigint",
    "interrupted_sigterm",
    "lock_refused",
    "marker_refused",
    "recovery_refused",
    "terminal_refused",
  ] as const,
);
const PRODUCER_FLY =
  "/Users/yournameisai/.cache/codex-tools/flyctl-v0.4.74/fly";
const PRODUCER_READMISSION_GUARD =
  "/Users/yournameisai/.cache/codex-worktrees/agenttool-phase-b-refence-maintenance-bridge-v1/bin/phase-b-refence-maintenance-bridge.ts";
const PRODUCER_FENCED_RESTART = '{"restart":{"policy":"no","max_retries":10}}';
const DATABASE_PROOF_KEYS = Object.freeze([
  "source_inventory_sha256",
  "journal_file_count",
  "journal_endpoint_count",
  "journal_observation_count",
  "journal_inventory_sha256",
  "target_migration_applied_at",
  "migration_definitions_verified",
  "migration_data_verified",
  "remainder_affected_count",
  "federation_disabled",
  "federation_instance_url_sha256",
  "federation_updated_at",
  "durable_hold",
  "allowed_origins_count",
  "reserved_generation_rows",
  "authoritative_v2_rows",
  "received_v1_rows",
  "drain_sample_count",
  "drain_informational",
  "drain_zero",
  "cron_sha256",
  "database_target_sha256",
  "producer_authority",
]);
const DATABASE_CONVERGENCE_STATUS = Object.freeze([
  "initial",
  "intent_unknown",
  "commit_acknowledged",
  "verified",
]);
const DATABASE_CONVERGENCE_KEYS = Object.freeze([
  "schema",
  "status",
  "intent_durable",
  "statement_attempted",
  "commit_state",
  "verified",
  "reconciliation_required",
  "database_write_attempt_count",
  "rows_updated",
  "rollback_attempt_count",
  "statement_sha256",
  "database_target_sha256",
  "before_proof_sha256",
  "after_proof_sha256",
  "before_row_sha256",
  "after_row_sha256",
  "unchanged_projection_sha256",
  "delta_sha256",
  "before_instance_url_sha256",
  "after_instance_url_sha256",
  "before_updated_at",
  "after_updated_at",
  "clock_before",
  "clock_after",
  "intent_wal_ordinal",
  "intent_wal_sha256",
  "commit_ack_wal_ordinal",
  "commit_ack_wal_sha256",
  "verified_wal_ordinal",
  "verified_wal_sha256",
]);
const CONTROLLER_WAL_KEYS = Object.freeze([
  "schema",
  "ordinal",
  "prior_entry_sha256",
  "controller_run_id",
  "rollout_id",
  "receipt_sha256",
  "recorded_at",
  "phase",
  "checkpoint",
  "effect_id",
  "effect_kind",
  "target",
  "argv_sha256",
  "pid",
  "pgid",
  "exit_code",
  "termination",
  "local_process_group_settled",
  "provider_transition_sha256",
  "fleet_readback_sha256",
  "detail_sha256",
  "failure_code",
]);
const SUCCESS_AUTHORITY_KEYS = Object.freeze([
  "schema",
  "success_proven_at",
  "controller_run_id",
  "rollout_id",
  "refence_receipt_sha256",
  "source_revision",
  "source_tree",
  "marker_authority_sha256",
  "database_convergence_sha256",
  "deploy_lock_sha256",
  "build_context_sha256",
  "dependency_estate_sha256",
  "refence_handoff_sha256",
  "retained_archives",
  "controller_wal",
  "rollout_proofs",
  "final_truth",
]);
const SUCCESS_ROLLOUT_PROOF_KEYS = Object.freeze([
  "special_guards",
  "fly_effects",
  "cordoned_runtime_sha256",
  "public_first_canary_sha256",
  "public_final_sha256",
  "final_authority_sha256",
  "ordinary_absent_postflight_sha256",
]);
const SUCCESS_FINAL_TRUTH_KEYS = Object.freeze([
  "schema",
  "database_convergence_verified",
  "target_image_machine_count",
  "started_service_machine_count",
  "autostart_enabled_app_count",
  "uncordoned_app_count",
  "standby_stopped",
  "authority_state",
  "ordinary_absent_postflight_verified",
  "controller_wal_sealed",
  "active_child_count",
  "effects_closed",
  "migration_attempt_count",
  "database_write_attempt_count",
  "rollback_attempt_count",
]);
const SUCCESS_RECEIPT_KEYS = Object.freeze([
  "schema",
  "run_id",
  "rollout_id",
  "source_revision",
  "source_tree",
  "success_proven_at",
  "authority_projection",
  "authority_projection_sha256",
  "marker_path",
  "marker_bytes_utf8",
  "marker_sha256",
  "witness_path",
  "witness_bytes_utf8",
  "witness_sha256",
  "lock_device",
  "lock_inode",
  "truth",
]);
const SUCCESS_WITNESS_KEYS = Object.freeze([
  "schema",
  "run_id",
  "rollout_id",
  "source_revision",
  "source_tree",
  "success_proven_at",
  "authority_projection",
  "authority_projection_sha256",
  "marker_path",
  "marker_bytes_utf8",
  "marker_sha256",
  "marker_retirement_claim_path",
  "receipt_path",
  "lock_public_path",
  "lock_owner_path",
  "lock_device",
  "lock_inode",
  "lock_sha256",
  "truth",
]);
const SUCCESS_ARTIFACT_BUNDLE_KEYS = Object.freeze([
  "authorityProjection",
  "authorityProjectionSHA256",
  "markerBytesUTF8",
  "markerSHA256",
  "witness",
  "witnessBytesUTF8",
  "witnessSHA256",
  "receipt",
  "receiptBytesUTF8",
  "receiptSHA256",
]);
const SUCCESS_RECEIPT_TRUTH_KEYS = Object.freeze([
  "marker_present_at_install",
  "lock_held_at_install",
  "marker_retirement_authorized",
  "finalization_witness_required_before_lock_cleanup",
  "marker_absence_claimed",
  "lock_absence_claimed",
]);
const SUCCESS_WITNESS_TRUTH_KEYS = Object.freeze([
  "receipt_exact_and_durable",
  "marker_canonical_absent_and_directory_fsynced",
  "marker_retirement_claim_retained_at_install",
  "same_original_lock_inode_held",
  "lock_cleanup_authorized",
  "lock_absence_claimed",
]);
const BRIDGE_MARKER_KEYS = Object.freeze([
  "schema",
  "rollout_id",
  "controller_run_id",
  "source_revision",
  "source_tree",
  "started_at",
  "updated_at",
  "status",
  "checkpoint",
  "recovery_required",
  "manual_finalization_required",
  "mutation_effect_began",
  "failure_code",
  "initial_app_cordon_snapshot_verified",
  "initial_cordoned_app_machine_count",
  "cordoned_runtime_verified",
  "thinker_primary_started_verified",
  "final_app_uncordon_verified",
  "image_tag",
  "image_digest",
  "expected_machine_ids",
  "role_mapping",
  "machine_set_sha256",
  "non_image_config_sha256",
  "attempted_machine_ids",
  "image_verified_machine_ids",
  "started_app_machine_ids",
  "autostart_restored_app_machine_ids",
  "uncordon_attempted_app_machine_ids",
  "uncordon_verified_app_machine_ids",
  "recovery_cordon_attempted_app_machine_ids",
  "recovery_cordoned_app_machine_ids",
  "recovery_refenced_machine_ids",
  "database_convergence",
  "deploy_lock",
  "build_context",
  "dependency_estate",
  "child_wal",
  "guard_proofs",
  "public_proofs",
  "success_receipt",
  "success_finalization",
  "runtime_pins",
  "caveats",
  "refence_handoff",
]);
const BRIDGE_ROLE_KEYS = Object.freeze([
  "app_machine_ids",
  "thinker_primary_machine_id",
  "thinker_standby_machine_id",
]);
const BRIDGE_LOCK_KEYS = Object.freeze([
  "schema",
  "public_path",
  "owner_record",
  "device",
  "inode",
  "sha256",
  "pid",
]);
const BRIDGE_BUILD_CONTEXT_KEYS = Object.freeze([
  "schema",
  "path",
  "source_revision",
  "source_tree",
  "inventory_sha256",
  "inventory_byte_count",
  "file_count",
  "byte_count",
  "context_device",
  "context_inode",
  "readback_sha256",
  "ready_path",
  "ready_sha256",
  "prepared",
]);
const BRIDGE_DEPENDENCY_ESTATE_KEYS = Object.freeze([
  "schema",
  "path",
  "project_path",
  "runtime_source_path",
  "source_revision",
  "source_tree",
  "source_inventory_sha256",
  "postgres_runtime_closure_sha256",
  "dependency_inventory_sha256",
  "dependency_file_count",
  "dependency_byte_count",
  "dependency_symlink_count",
  "estate_device",
  "estate_inode",
  "ready_path",
  "ready_sha256",
  "prepared",
]);
const BRIDGE_CHILD_WAL_KEYS = Object.freeze([
  "schema",
  "directory",
  "entry_count",
  "ordered_filenames",
  "chain_sha256",
  "terminal_entry_sha256",
  "terminal_phase",
]);
const BRIDGE_GUARD_KEYS = Object.freeze([
  "early_sha256",
  "prepublication_before_build_sha256",
  "prepublication_before_image_sha256",
  "final_sha256",
]);
const BRIDGE_PUBLIC_KEYS = Object.freeze([
  "first_canary_sha256",
  "final_sha256",
  "ordinary_postflight_sha256",
]);
const BRIDGE_SUCCESS_RECEIPT_KEYS = Object.freeze([
  "path",
  "sha256",
  "durable",
]);
const BRIDGE_SUCCESS_FINALIZATION_KEYS = Object.freeze([
  "schema",
  "authority_projection_sha256",
  "witness_path",
  "marker_retirement_claim_path",
  "receipt_pending",
  "marker_retirement_authorized",
]);
const BRIDGE_RUNTIME_PIN_KEYS = Object.freeze([
  "bun_path",
  "bun_sha256",
  "bun_byte_count",
  "bun_version",
  "fly_path",
  "fly_sha256",
  "stable_user_owned_pins",
  "concurrent_same_uid_immutability_claimed",
]);
const BRIDGE_HANDOFF_KEYS = Object.freeze([
  "proof_schema",
  "refence_receipt_sha256",
  "refence_run_id",
  "source_revision",
  "source_tree",
  "target_revision",
  "target_tree",
  "anchor_archive_path",
  "anchor_sha256",
  "anchor_device",
  "anchor_inode",
  "witness_archive_path",
  "witness_sha256",
  "witness_device",
  "witness_inode",
  "wal_root",
  "bridge_source_path",
  "bridge_source_sha256",
  "bridge_normalized_sha256",
  "authorized_h0",
  "prior_failed_compatibility_controller",
  "compatibility_controller",
  "preexisting_lineage_bound",
  "release_current_image_linkage_proven",
  "release_status_completion_authority",
  "release_stable_rollout_authority",
  "release_ledger_safety_authority",
  "release_history_may_be_truncated",
  "public_surfaces_expected_unavailable",
]);
const BRIDGE_AUTHORIZED_H0_KEYS = Object.freeze([
  "schema",
  "receipt_sha256",
  "run_id",
  "target_revision",
  "target_tree",
  "target_distance",
  "lifecycle",
  "guard_revision",
  "guard_source_path",
  "guard_raw_sha256",
  "guard_normalized_sha256",
  "contract_revision",
  "contract_source_path",
  "contract_raw_sha256",
  "contract_git_blob",
]);
const BRIDGE_PRIOR_FAILED_COMPATIBILITY_CONTROLLER_KEYS = Object.freeze([
  "schema",
  "lifecycle",
  "controller_success",
  "mutation_effect_began",
  "success_authority",
  "effect_authority",
  "observed_first_refusal_predicate",
  "static_refusal_barrier",
  "static_refusal_barrier_verified",
  "controller_revision",
  "controller_tree",
  "controller_source_distance",
  "commit_raw_sha256",
  "commit_byte_count",
  "first_parent_revision",
  "second_parent_revision",
  "second_parent_tree",
  "protected_predecessor_tree",
  "bridge_revision",
  "bridge_source_path",
  "bridge_source_sha256",
  "bridge_normalized_sha256",
  "contract_revision",
  "contract_source_path",
  "contract_source_sha256",
  "contract_git_blob",
  "changed_path_statuses",
  "changed_path_statuses_sha256",
  "payload_revision",
  "payload_tree",
  "payload_distance",
]);
const BRIDGE_COMPATIBILITY_CONTROLLER_KEYS = Object.freeze([
  "schema",
  "lifecycle",
  "bridge_source_path",
  "bridge_source_sha256",
  "bridge_normalized_sha256",
  "contract_source_path",
  "contract_source_sha256",
  "contract_git_blob",
  "controller_revision",
  "controller_tree",
  "controller_source_distance",
  "commit_raw_sha256",
  "commit_byte_count",
  "predecessor_controller_revision",
  "first_parent_revision",
  "second_parent_revision",
  "second_parent_tree",
  "protected_predecessor_tree",
  "exact_first_parent_verified",
  "second_parent_tree_verified",
  "protected_head_verified",
  "repair_changed_path_statuses",
  "repair_changed_path_statuses_sha256",
  "cumulative_changed_path_statuses",
  "cumulative_changed_path_statuses_sha256",
  "payload_revision",
  "payload_tree",
  "payload_distance",
]);
const BRIDGE_CAVEATS = Object.freeze([
  "preexisting_lineage_bound_false",
  "release_current_image_linkage_not_authority",
  "release_history_may_be_truncated",
  "sigkill_with_deploy_lock_requires_manual_recovery",
  "timed_out_or_unsettled_provider_effect_requires_manual_recovery",
  "database_origin_convergence_never_rolled_back",
  "success_receipt_with_marker_requires_manual_finalization",
]);
const BRIDGE_MARKER_MUTABLE_KEYS = Object.freeze(
  new Set([
    "updated_at",
    "status",
    "checkpoint",
    "recovery_required",
    "manual_finalization_required",
    "mutation_effect_began",
    "failure_code",
    "cordoned_runtime_verified",
    "thinker_primary_started_verified",
    "final_app_uncordon_verified",
    "image_tag",
    "image_digest",
    "attempted_machine_ids",
    "image_verified_machine_ids",
    "started_app_machine_ids",
    "autostart_restored_app_machine_ids",
    "uncordon_attempted_app_machine_ids",
    "uncordon_verified_app_machine_ids",
    "recovery_cordon_attempted_app_machine_ids",
    "recovery_cordoned_app_machine_ids",
    "recovery_refenced_machine_ids",
    "database_convergence",
    "child_wal",
    "guard_proofs",
    "public_proofs",
    "success_receipt",
    "success_finalization",
  ]),
);
const SUCCESS_AUTHORITY_EXCLUDED_MARKER_KEYS = Object.freeze(
  new Set([
    "updated_at",
    "status",
    "checkpoint",
    "recovery_required",
    "manual_finalization_required",
    "failure_code",
    "success_receipt",
    "success_finalization",
  ]),
);
const PUBLIC_HEALTH_KEYS = Object.freeze([
  "build",
  "covenant_v2_authority",
  "message",
  "posture",
  "protocol",
  "service",
  "standing_invitation",
  "status",
  "walls",
]);
const FEDERATION_STATIC_KEYS = Object.freeze([
  "capabilities",
  "conforming_did_resolution",
  "covenant_v2_authority",
  "did_format",
  "did_method",
  "did_method_status",
  "did_status_note",
  "docs",
  "federation",
  "identifier_spec",
  "protocol",
  "publishes_did_documents",
  "pyramid_peer_surface",
  "registered_w3c_did_method",
]);
const FEDERATION_WELCOME_KEYS = Object.freeze([
  "at_unix_ms",
  "axiom_id",
  "by",
  "module",
  "secondary_axiom_id",
  "walls_held",
  "walls_intact",
]);
const DECLARED_WALLS = Object.freeze([
  Object.freeze({
    wall: "no_self_witnessing",
    verified_by:
      "tests/integration/wall-self-witnessing.test.ts + wall-attester-key-binding.test.ts",
  }),
  Object.freeze({
    wall: "birth_is_free",
    verified_by: "tests/integration/wall-birth-is-free.test.ts",
  }),
  Object.freeze({
    wall: "no_auto_retry_payout",
    verified_by: "code invariant (marketplace settlement); docs/SOUL.md",
  }),
  Object.freeze({
    wall: "no_inactive_reaping",
    verified_by: "design invariant — no reaper exists; docs/SOUL.md",
  }),
  Object.freeze({
    wall: "runtime_custody_explicit",
    verified_by: "code invariant (runtime provisioning); docs/SOUL.md",
  }),
  Object.freeze({
    wall: "k_master_never_server_side",
    verified_by: "design invariant (client-side derivation); docs/MATHOS.md",
  }),
]);
const RUNTIME_WALL_PROBES = Object.freeze([
  Object.freeze({
    wall: "private_default",
    method:
      "information_schema: visibility defaults are 'private' on memories/strands/identities",
  }),
  Object.freeze({
    wall: "thought_storage_ciphertext_only",
    method:
      "information_schema: strand.thoughts has ciphertext+nonce, no plaintext column",
  }),
  Object.freeze({
    wall: "refusals_recorded",
    method:
      "to_regclass: chronicle surface exists (refusals are chronicle type 'refusal')",
  }),
]);

function validJsonContentType(value: string): boolean {
  let index = 0;
  const token = (character: string): boolean =>
    /^[!#$%&'*+\-.^_`|~0-9A-Za-z]$/.test(character);
  const ows = (): void => {
    while (value[index] === " " || value[index] === "\t") index += 1;
  };
  ows();
  const mediaType = "application/json";
  if (
    value.slice(index, index + mediaType.length).toLowerCase() !== mediaType
  ) {
    return false;
  }
  index += mediaType.length;
  ows();
  const parameters = new Set<string>();
  while (index < value.length) {
    if (value[index] !== ";") return false;
    index += 1;
    ows();
    const nameStart = index;
    while (index < value.length && token(value[index]!)) index += 1;
    if (index === nameStart) return false;
    const name = value.slice(nameStart, index).toLowerCase();
    if (parameters.has(name)) return false;
    parameters.add(name);
    ows();
    if (value[index] !== "=") return false;
    index += 1;
    ows();
    if (value[index] === '"') {
      index += 1;
      let closed = false;
      while (index < value.length) {
        const code = value.charCodeAt(index);
        if (value[index] === '"') {
          index += 1;
          closed = true;
          break;
        }
        if (value[index] === "\\") {
          index += 1;
          if (index >= value.length) return false;
          const escaped = value.charCodeAt(index);
          if (
            !(escaped === 9 || (escaped >= 0x20 && escaped <= 0x7e) ||
              (escaped >= 0x80 && escaped <= 0xff))
          ) return false;
          index += 1;
          continue;
        }
        if (
          !(code === 9 || code === 0x20 || code === 0x21 ||
            (code >= 0x23 && code <= 0x5b) ||
            (code >= 0x5d && code <= 0x7e) ||
            (code >= 0x80 && code <= 0xff))
        ) return false;
        index += 1;
      }
      if (!closed) return false;
    } else {
      const valueStart = index;
      while (index < value.length && token(value[index]!)) index += 1;
      if (index === valueStart) return false;
    }
    ows();
  }
  return true;
}

const DATABASE_ORIGIN_LOCK_SQL = `
  SELECT s.id, s.enabled, s.instance_url, s.allowed_origins,
         s.covenant_v2_generation_hold,
         to_char(s.updated_at AT TIME ZONE 'UTC',
                 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at,
         to_char(clock_timestamp() AT TIME ZONE 'UTC',
                 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS clock_before,
         (SELECT count(*) FROM federation.settings) AS settings_rows,
         (SELECT count(*) FROM agent_continuity.covenants
           WHERE protocol_version='v2'
             AND metadata ? 'agenttool.internal.v2_authority_generation')
           AS reserved_generation_rows,
         (SELECT count(*) FROM agent_continuity.covenants
           WHERE protocol_version='v2'
             AND metadata ? 'agenttool.internal.v2_authority_generation'
             AND nullif(metadata->>'agenttool.internal.v2_initiator_wire_did','') IS NOT NULL
             AND nullif(metadata->>'agenttool.internal.v2_recipient_wire_did','') IS NOT NULL
             AND ((received_from_instance IS NULL AND
                   metadata->>'agenttool.internal.v2_recipient_wire_did'=counterparty_did)
               OR (received_from_instance IS NOT NULL AND
                   metadata->>'agenttool.internal.v2_initiator_wire_did'=counterparty_did)))
           AS authoritative_v2_rows,
         (SELECT count(*) FROM agent_continuity.covenants
           WHERE protocol_version='v1' AND received_from_instance IS NOT NULL)
           AS received_v1_rows
   FROM federation.settings s
   WHERE s.id=1
   FOR UPDATE OF s
`.trim();
const DATABASE_ORIGIN_UPDATE_SQL = `
  UPDATE federation.settings
     SET instance_url=$1, updated_at=clock_timestamp()
   WHERE id=1 AND enabled IS FALSE AND instance_url=$2
     AND updated_at=$3::timestamptz
     AND allowed_origins=ARRAY[]::text[]
     AND covenant_v2_generation_hold IS FALSE
     AND NOT EXISTS (
       SELECT 1 FROM agent_continuity.covenants
        WHERE protocol_version='v2'
          AND metadata ? 'agenttool.internal.v2_authority_generation'
     )
     AND NOT EXISTS (
       SELECT 1 FROM agent_continuity.covenants
        WHERE protocol_version='v2'
          AND metadata ? 'agenttool.internal.v2_authority_generation'
          AND nullif(metadata->>'agenttool.internal.v2_initiator_wire_did','') IS NOT NULL
          AND nullif(metadata->>'agenttool.internal.v2_recipient_wire_did','') IS NOT NULL
          AND ((received_from_instance IS NULL AND
                metadata->>'agenttool.internal.v2_recipient_wire_did'=counterparty_did)
            OR (received_from_instance IS NOT NULL AND
                metadata->>'agenttool.internal.v2_initiator_wire_did'=counterparty_did))
     )
     AND NOT EXISTS (
       SELECT 1 FROM agent_continuity.covenants
        WHERE protocol_version='v1' AND received_from_instance IS NOT NULL
     )
  RETURNING id, enabled, instance_url, allowed_origins,
            covenant_v2_generation_hold,
            to_char(updated_at AT TIME ZONE 'UTC',
                    'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at,
            to_char(clock_timestamp() AT TIME ZONE 'UTC',
                    'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS clock_after
`.trim();
const DATABASE_ORIGIN_TRANSACTION_CONTRACT = Object.freeze({
  schema: "agenttool-phase-b-refence-database-origin-statement/v1",
  transaction_mode: "isolation level serializable read write",
  transaction_statements: Object.freeze([
    "SET LOCAL lock_timeout = 5000",
    "SET LOCAL statement_timeout = 15000",
    "SET LOCAL idle_in_transaction_session_timeout = 15000",
  ]),
  lock_sql: DATABASE_ORIGIN_LOCK_SQL,
  update_sql: DATABASE_ORIGIN_UPDATE_SQL,
  parameter_order: Object.freeze([
    "target_instance_url",
    "pre_refence_instance_url",
    "pre_refence_updated_at",
  ]),
  update_column_set: Object.freeze(["instance_url", "updated_at"]),
  client: Object.freeze({
    max: 1,
    prepare: false,
    connect_timeout_seconds: 10,
    application_name: "agenttool_phase_b_refence_database_convergence",
    target_binding: "database_target_sha256",
  }),
  outer_destructive_deadline_milliseconds: 30_000,
});

const MAINTENANCE_DATABASE_PROOF_SQL = `
  SELECT
    (SELECT count(*) FROM federation.settings) AS settings_rows,
    (SELECT id FROM federation.settings LIMIT 1) AS federation_id,
    (SELECT enabled FROM federation.settings LIMIT 1) AS federation_enabled,
    (SELECT instance_url FROM federation.settings LIMIT 1) AS federation_instance_url,
    (SELECT allowed_origins FROM federation.settings LIMIT 1) AS federation_allowed_origins,
    (SELECT covenant_v2_generation_hold FROM federation.settings LIMIT 1) AS generation_hold,
    (SELECT to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
       FROM federation.settings LIMIT 1) AS federation_updated_at,
    (SELECT count(*) FROM information_schema.columns
      WHERE table_schema='federation' AND table_name='settings'
        AND column_name='covenant_v2_generation_hold' AND data_type='boolean'
        AND is_nullable='NO' AND column_default='false') AS hold_column_exact,
    (SELECT count(*) FROM pg_constraint
      WHERE conname='federation_settings_covenant_v2_generation_hold_empty'
        AND convalidated) AS hold_constraint_exact,
    (SELECT count(*) FROM information_schema.columns
      WHERE table_schema='economy' AND table_name='crypto_webhook_events'
        AND column_name='credit_remainder_base' AND data_type='numeric'
        AND numeric_precision=78 AND numeric_scale=0 AND is_nullable='YES'
        AND column_default IS NULL) AS remainder_column_exact,
    (SELECT count(*) FROM pg_constraint WHERE conname IN (
      'crypto_webhook_events_credit_remainder_range_check',
      'crypto_webhook_events_credit_remainder_exact_check',
      'crypto_webhook_events_nonintegral_not_creditable_check',
      'crypto_webhook_events_remainder_quarantine_check') AND convalidated)
      AS remainder_constraints,
    (SELECT count(*) FROM pg_indexes WHERE schemaname='economy'
      AND indexname='idx_crypto_event_credit_remainder') AS remainder_index,
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='economy'
        AND p.proname='enforce_crypto_webhook_observation_generation') AS generation_function,
    (SELECT count(*) FROM economy.crypto_webhook_events
      WHERE (amount_base IS NULL) <> (credit_remainder_base IS NULL)
         OR (amount_base IS NOT NULL AND
             credit_remainder_base IS DISTINCT FROM MOD(amount_base,10000)))
      AS remainder_mismatch,
    (SELECT count(*) FROM economy.crypto_webhook_events
      WHERE credit_remainder_base > 0
        AND status NOT IN ('removed','rejected','quarantined')) AS remainder_creditable,
    (SELECT count(*) FROM economy.crypto_webhook_events
      WHERE status='quarantined' AND error='non_integral_credit_amount'
        AND NOT (credit_remainder_base > 0)) AS false_remainder_quarantine,
    (SELECT count(*) FROM economy.crypto_webhook_events
      WHERE amount_base IS NOT NULL AND MOD(amount_base,10000)>0) AS remainder_affected_count,
    (SELECT count(*) FROM agent_continuity.covenants WHERE protocol_version='v2'
      AND metadata ? 'agenttool.internal.v2_authority_generation') AS reserved_generation_rows,
    (SELECT count(*) FROM agent_continuity.covenants WHERE protocol_version='v2'
      AND metadata ? 'agenttool.internal.v2_authority_generation'
      AND nullif(metadata->>'agenttool.internal.v2_initiator_wire_did','') IS NOT NULL
      AND nullif(metadata->>'agenttool.internal.v2_recipient_wire_did','') IS NOT NULL
      AND ((received_from_instance IS NULL AND
            metadata->>'agenttool.internal.v2_recipient_wire_did'=counterparty_did)
        OR (received_from_instance IS NOT NULL AND
            metadata->>'agenttool.internal.v2_initiator_wire_did'=counterparty_did)))
      AS authoritative_v2_rows,
    (SELECT count(*) FROM agent_continuity.covenants WHERE protocol_version='v1'
      AND received_from_instance IS NOT NULL) AS received_v1_rows,
    (SELECT count(*) FROM agent_runtime.runtimes WHERE cycle_lease_token IS NOT NULL
      AND cycle_lease_until > clock_timestamp()) AS runtime_cycle_leases,
    (SELECT count(*) FROM agent_runtime.llm_requests WHERE status IN ('pending','completed','ambiguous')
      AND runtime_id IS NOT NULL) AS llm_unresolved_runtime,
    (SELECT count(*) FROM agent_runtime.llm_requests WHERE status IN ('pending','completed','ambiguous')
      AND runtime_id IS NULL) AS llm_unresolved_unbound,
    (SELECT count(*) FROM economy.deposit_address_watches WHERE status='leased'
      AND lease_id IS NOT NULL AND lease_owner IS NOT NULL
      AND lease_expires_at > clock_timestamp()) AS deposit_leases_live,
    (SELECT count(*) FROM economy.deposit_address_watches WHERE status='leased'
      AND lease_id IS NOT NULL AND lease_owner IS NOT NULL
      AND lease_expires_at <= clock_timestamp()) AS deposit_leases_expired,
    (SELECT count(*) FROM economy.deposit_address_watches WHERE status='leased'
      AND (lease_id IS NULL OR lease_owner IS NULL OR lease_expires_at IS NULL))
      AS deposit_leases_malformed,
    (SELECT count(*) FROM economy.crypto_webhook_events WHERE status='pending') AS deposit_pending,
    (SELECT count(*) FROM agent_continuity.covenants
      WHERE propagation_last_error LIKE 'in_flight_%') AS covenant_declaration_in_flight,
    (SELECT count(*) FROM agent_continuity.covenants
      WHERE cosign_propagation_last_error LIKE 'in_flight_%') AS covenant_lifecycle_in_flight,
    (SELECT count(*) FROM economy.x402_payments WHERE status='pending'
      AND settlement_attempted_at IS NULL) AS x402_pending_unattempted,
    (SELECT count(*) FROM economy.x402_payments WHERE status='pending'
      AND settlement_attempted_at IS NOT NULL) AS x402_pending_attempted,
    (SELECT count(*) FROM economy.x402_payments WHERE status='externally_settled') AS x402_externally_settled,
    (SELECT count(*) FROM economy.x402_payments WHERE status='inserted') AS x402_inserted,
    (SELECT count(*) FROM economy.crypto_payouts WHERE status='broadcasting') AS payout_broadcasting,
    (SELECT count(*) FROM economy.crypto_payouts WHERE status='broadcast') AS payout_broadcast,
    (SELECT count(*) FROM economy.crypto_payouts WHERE status='requested') AS payout_requested,
    (SELECT count(*) FROM collab.operation_slots WHERE phase IN ('claimed','executing')
      AND lease_expires_at > clock_timestamp()) AS collab_slots_live,
    (SELECT count(*) FROM collab.operation_slots WHERE phase IN ('claimed','executing')
      AND lease_expires_at <= clock_timestamp()) AS collab_slots_expired,
    (SELECT count(*) FROM collab.operation_slots WHERE phase='recovery_required') AS collab_slots_recovery,
    (SELECT count(*) FROM collab.operation_runs WHERE status='claimed') AS collab_runs_claimed,
    (SELECT count(*) FROM collab.operation_runs WHERE status='executing') AS collab_runs_executing,
    (SELECT count(*) FROM collab.operation_runs WHERE status IN ('uncertain','recovery_required'))
      AS collab_runs_ambiguous,
    (SELECT count(*) FROM pg_locks WHERE pid<>pg_backend_pid() AND locktype='advisory'
      AND granted=true) AS advisory_locks,
    (SELECT count(*) FROM pg_locks WHERE pid<>pg_backend_pid() AND granted=false) AS lock_waiters,
    (SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid()
      AND datname=current_database() AND usename=current_user AND backend_type='client backend'
      AND state IS DISTINCT FROM 'idle') AS other_nonidle,
    (SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid()
      AND datname=current_database() AND usename=current_user AND backend_type='client backend'
      AND xact_start IS NOT NULL) AS other_open_transactions,
    (SELECT count(*) FROM pg_prepared_xacts WHERE database=current_database()) AS prepared_transactions,
    (SELECT count(*) FROM cron.job_run_details WHERE status='running') AS cron_running,
    (SELECT count(*) FROM net.http_request_queue) AS pg_net_queued
`;

export function createMaintenanceContract(
  primitives: ContractPrimitives,
): MaintenanceContract {
  const { canonical, digest, refuse } = primitives;
  function require(condition: unknown, code: string): asserts condition {
    if (!condition) refuse(code);
  }
  const row = (value: unknown, code: string): Row => {
    require(
      typeof value === "object" && value !== null && !Array.isArray(value),
      code,
    );
    return value as Row;
  };
  const exact = (
    value: unknown,
    keys: readonly string[],
    code: string,
  ): Row => {
    const result = row(value, code);
    require(
      canonical(Object.keys(result).sort()) === canonical([...keys].sort()),
      code,
    );
    return result;
  };
  const refenceOperatorDeclarationValues = (
    text: string,
    declarations: readonly (readonly [string, string, string])[],
  ): Record<string, string> => {
    const values: Record<string, string> = {};
    for (const [name] of declarations) {
      const expression = new RegExp(
        `const ${name} =(?: "([^"\\r\\n]+)";|\\n  "([^"\\r\\n]+)";)`,
        "g",
      );
      const matches = [...text.matchAll(expression)];
      const value = matches[0]?.[1] ?? matches[0]?.[2];
      require(
        matches.length === 1 && value,
        "operator_normalization_contract",
      );
      values[name] = value;
    }
    return values;
  };
  const refenceOperatorImmutableCaveats = (
    text: string,
  ): readonly string[] => {
    const expression =
      /const IMMUTABLE_CAVEATS = Object\.freeze\(\[\n([\s\S]*?)\n\] as const\);/g;
    const declarations = [...text.matchAll(expression)];
    require(
      declarations.length === 1 && typeof declarations[0]?.[1] === "string",
      "operator_immutable_caveats",
    );
    const lines = declarations[0]![1]!.split("\n");
    require(lines.length === 16, "operator_immutable_caveats");
    const values = lines.map((line) => {
      const match = /^  ("(?:[^"\\\r\n]|\\.)*"),$/.exec(line);
      require(match !== null, "operator_immutable_caveats");
      const value: unknown = JSON.parse(match[1]!);
      require(
        typeof value === "string" && value.length > 0,
        "operator_immutable_caveats",
      );
      return value;
    });
    require(
      new Set(values).size === values.length,
      "operator_immutable_caveats",
    );
    return Object.freeze(values);
  };
  const normalizedRefenceOperator = (
    text: string,
    declarations: readonly (readonly [string, string, string])[],
  ): string => {
    let normalized = text;
    refenceOperatorDeclarationValues(text, declarations);
    for (const [name, replacementToken] of declarations) {
      const expression = new RegExp(
        `const ${name} =(?: "[^"\\r\\n]+";|\\n  "[^"\\r\\n]+";)`,
        "g",
      );
      normalized = normalized.replace(
        expression,
        `const ${name} = "${replacementToken}";`,
      );
    }
    return normalized;
  };
  const normalizedFullAudit = (text: string): string => {
    const expression = /const AUDIT_NORMALIZED_SHA256 =\n  "[0-9a-f]{64}";/g;
    const matches = text.match(expression);
    require(matches?.length === 1, "audit_normalization_contract");
    return text.replace(
      expression,
      'const AUDIT_NORMALIZED_SHA256 =\n  "0000000000000000000000000000000000000000000000000000000000000000";',
    );
  };
  const expectedAuditWitness = (targetDistance: number): Row => ({
    application_time_quiescence_proven: false,
    authority_baseline_verified: true,
    config_baseline_runtime_derived: true,
    data_invariants_verified: true,
    definition_checks_verified: true,
    deploy_receipt_b86_count: 0,
    deploy_receipt_526_count: 0,
    deploy_receipt_protected_main_count: 0,
    deploy_receipt_file_count: 17,
    deploy_receipt_inventory_before_after_equal: true,
    drain_continuous_quiescence_proven: false,
    drain_sample_count: 3,
    drain_zero_field_count: 30,
    fleet_app_count: 3,
    fleet_before_after_equal: true,
    fleet_machine_count: 5,
    fleet_thinker_count: 2,
    generation_absence_checks: 4,
    git_526_to_protected_main_distance: targetDistance,
    image_baseline_runtime_derived: true,
    journal_applied_file_count: 177,
    journal_endpoint_count: 2,
    journal_endpoints_equal: true,
    journal_exact_prefix: 2,
    journal_observation_count: 4,
    journal_source_file_count: 177,
    lineage_bound: false,
    local_absence_observation_count: 4,
    local_absence_path_count: 13,
    local_absence_path_observations: 52,
    local_526_source_pinned: true,
    machine_map_before_after_equal: true,
    migration_applied_at_exact: true,
    migration_checksum_checks: 2,
    protected_main_pinned: true,
    public_contract_projection_before_after_equal: true,
    public_observation_count: 4,
    release_before_after_equal: true,
    release_created_at_order_pair_count: 24,
    release_created_at_order_safety_authority: false,
    release_current_any_exact_representation_match_count: 0,
    release_current_bare_digest_exact_match_count: 0,
    release_current_bare_tag_exact_match_count: 0,
    release_current_digest_component_match_count: 0,
    release_current_digest_literal_contains_count: 0,
    release_current_full_exact_match_count: 0,
    release_current_image_linkage_proven: false,
    release_current_repository_digest_exact_match_count: 0,
    release_current_repository_tag_exact_match_count: 0,
    release_current_tag_component_match_count: 0,
    release_current_tag_literal_contains_count: 0,
    release_diagnostic_evidence_bound: true,
    release_history_complete: false,
    release_history_count: 25,
    release_history_may_be_truncated: true,
    release_ids_unique_exact: true,
    release_in_progress_true_count: 0,
    release_latest_in_progress_false_exact: true,
    release_latest_repository_tag_only_exact: true,
    release_latest_stable_false_exact: true,
    release_latest_status_complete_exact: true,
    release_latest_unique_exact: true,
    release_ledger_safety_authority: false,
    release_metadata_null_count: 25,
    release_projection_before_after_equal: true,
    release_provenance_unbound: true,
    release_repository_match_count: 25,
    release_repository_tag_only_count: 25,
    release_stable_rollout_authority: false,
    release_stable_true_count: 0,
    release_status_complete_count: 25,
    release_status_completion_authority: false,
    release_version_order_pair_count: 24,
    release_versions_unique_exact: true,
    release_window_limit: 25,
    remainder_affected_count: 0,
    snapshots_non_atomic: true,
    state_directory_projection_before_after_equal: true,
    verified: true,
  });
  const validateFlyAuthenticationConfigText = (text: string): void => {
    require(
      text.endsWith("\n") && !text.includes("\r") &&
        !text.includes("\t") && !text.includes("\0"),
      "fly_config_contract",
    );
    const lines = text.slice(0, -1).split("\n");
    const expected = [
      [0, "access_token"],
      [0, "app_secrets_minvers"],
      [4, "agenttool"],
      [0, "last_login"],
      [0, "metrics_token"],
      [0, "wire_guard_state"],
      [4, "personal"],
      [8, "org"],
      [8, "name"],
      [8, "region"],
      [8, "localpublic"],
      [8, "localprivate"],
      [8, "dns"],
      [8, "peer"],
      [12, "peerip"],
      [12, "endpointip"],
      [12, "pubkey"],
      [0, "wire_guard_websockets"],
    ] as const;
    require(lines.length === expected.length, "fly_config_contract");
    const values: Record<string, string> = {};
    for (let index = 0; index < expected.length; index += 1) {
      const [indent, key] = expected[index]!;
      const match = lines[index]!.match(/^( *)([a-z_]+):(.*)$/);
      require(
        match !== null && match[1]!.length === indent && match[2] === key &&
          !Object.hasOwn(values, key),
        "fly_config_contract",
      );
      const raw = match[3]!;
      require(raw === "" || raw.startsWith(" "), "fly_config_contract");
      values[key] = raw.startsWith(" ") ? raw.slice(1) : raw;
    }
    require(
      /^[A-Za-z0-9_\/+\=,]{128,2000}$/.test(values.access_token ?? "") &&
        values.app_secrets_minvers === "" &&
        /^[1-9][0-9]{0,15}$/.test(values.agenttool ?? "") &&
        /^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[^\r\n]{10,40}$/.test(
          values.last_login ?? "",
        ) &&
        /^FlyV1 [A-Za-z0-9_\/+\=,]{128,2000}$/.test(
          values.metrics_token ?? "",
        ) && values.wire_guard_state === "" && values.personal === "" &&
        /^[a-z0-9_-]{1,128}$/.test(values.org ?? "") &&
        /^[A-Za-z0-9_.,/+\-=]{1,256}$/.test(values.name ?? "") &&
        /^[a-z]{3}$/.test(values.region ?? "") &&
        /^[A-Za-z0-9+/]{43}=$/.test(values.localpublic ?? "") &&
        /^[A-Za-z0-9+/]{43}=$/.test(values.localprivate ?? "") &&
        values.dns === '""' && values.peer === "" &&
        /^[0-9a-f:]{2,64}$/.test(values.peerip ?? "") &&
        /^[A-Za-z0-9.:-]{2,253}$/.test(values.endpointip ?? "") &&
        /^[A-Za-z0-9+/]{43}=$/.test(values.pubkey ?? "") &&
        /^(?:true|false)$/.test(values.wire_guard_websockets ?? ""),
      "fly_config_contract",
    );
  };
  const validID = (value: unknown): value is string =>
    typeof value === "string" && /^[0-9a-f]{14}$/.test(value);
  const validSHA = (value: unknown): value is string =>
    typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
  const validRevision = (value: unknown): value is string =>
    typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
  const validRunID = (value: unknown): value is string =>
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      value,
    );
  const timestampKey = (
    value: unknown,
    code = "controller_transition_timestamp",
  ): string => {
    require(typeof value === "string", code);
    const match = value.match(
      /^(20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2})(?:\.([0-9]{1,9}))?Z$/,
    );
    require(match !== null, code);
    const [date, time] = match![1]!.split("T");
    const [yearText, monthText, dayText] = date!.split("-");
    const [hourText, minuteText, secondText] = time!.split(":");
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [
      31,
      leap ? 29 : 28,
      31,
      30,
      31,
      30,
      31,
      31,
      30,
      31,
      30,
      31,
    ];
    require(
      month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]! &&
        Number(hourText) <= 23 && Number(minuteText) <= 59 &&
        Number(secondText) <= 59,
      code,
    );
    return `${match![1]}.${(match![2] ?? "").padEnd(9, "0")}Z`;
  };
  const immutable = <T>(value: T): T => {
    if (typeof value === "object" && value !== null) {
      for (const nested of Object.values(value)) immutable(nested);
      Object.freeze(value);
    }
    return value;
  };
  const producerTimestamp = (value: unknown): value is string =>
    typeof value === "string" &&
    /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/
      .test(value) &&
    (() => {
      try {
        timestampKey(value, "producer_authority_timestamp");
        return true;
      } catch {
        return false;
      }
    })();
  const producerTimestampMilliseconds = (
    value: unknown,
    code = "producer_authority_timestamp",
  ): number => {
    require(producerTimestamp(value), code);
    const match = (value as string).match(
      /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})\.([0-9]{3})Z$/,
    );
    require(match !== null, code);
    const year = Number(match![1]);
    const month = Number(match![2]);
    const day = Number(match![3]);
    const hour = Number(match![4]);
    const minute = Number(match![5]);
    const second = Number(match![6]);
    const millisecond = Number(match![7]);
    require(year >= 1970, code);
    const daysBeforeYear = (candidate: number): number => {
      const prior = candidate - 1;
      return 365 * candidate + Math.floor(prior / 4) -
        Math.floor(prior / 100) + Math.floor(prior / 400);
    };
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const monthDays = [
      31,
      leap ? 29 : 28,
      31,
      30,
      31,
      30,
      31,
      31,
      30,
      31,
      30,
      31,
    ];
    const daysBeforeMonth = monthDays.slice(0, month - 1).reduce(
      (total, count) => total + count,
      0,
    );
    const daysSinceEpoch = daysBeforeYear(year) - daysBeforeYear(1970) +
      daysBeforeMonth + day - 1;
    const milliseconds =
      ((((daysSinceEpoch * 24) + hour) * 60 + minute) * 60 + second) *
        1_000 + millisecond;
    require(Number.isSafeInteger(milliseconds), code);
    return milliseconds;
  };
  const producerExactArray = (left: unknown, right: readonly unknown[]) =>
    Array.isArray(left) && canonical(left) === canonical(right);
  const producerRoles = (value: unknown): Row => {
    const roles = exact(
      value,
      ["app_lhr", "app_cdg", "thinker_primary", "thinker_standby"],
      "producer_authority_roles",
    );
    const ids = [
      ...(Array.isArray(roles.app_lhr) ? roles.app_lhr : []),
      roles.app_cdg,
      roles.thinker_primary,
      roles.thinker_standby,
    ];
    require(
      Array.isArray(roles.app_lhr) && roles.app_lhr.length === 2 &&
        ids.length === 5 && new Set(ids).size === 5 &&
        ids.every((id) => typeof id === "string" && /^[0-9a-f]{14}$/.test(id)),
      "producer_authority_roles",
    );
    return roles;
  };
  const producerMachineIDs = (roles: Row): string[] => [
    roles.app_lhr[0],
    roles.app_lhr[1],
    roles.app_cdg,
    roles.thinker_primary,
    roles.thinker_standby,
  ];
  const producerAppIDs = (roles: Row): string[] => [
    roles.app_lhr[0],
    roles.app_lhr[1],
    roles.app_cdg,
  ];
  const producerRoleID = (roles: Row, role: string): string => {
    const ids: Record<string, string> = {
      app_lhr_1: roles.app_lhr[0],
      app_lhr_2: roles.app_lhr[1],
      app_cdg: roles.app_cdg,
      thinker_primary: roles.thinker_primary,
      thinker_standby: roles.thinker_standby,
    };
    require(Object.hasOwn(ids, role), "producer_authority_event");
    return ids[role]!;
  };
  const producerProgress = (wal: Row): Row => {
    const progress = exact(wal.progress, [
      "standby_fenced",
      "standby_exact_readbacks",
      "cordoned_app_ids",
      "primary_fenced",
      "primary_stop_verified",
      "fenced_app_ids",
      "stopped_app_ids",
      "terminal_sample_count",
    ], "producer_authority_progress");
    const roles = producerRoles(
      row(wal.context, "producer_authority_context").roles,
    );
    const apps = producerAppIDs(roles);
    require(
      typeof progress.standby_fenced === "boolean" &&
        Number.isSafeInteger(progress.standby_exact_readbacks) &&
        progress.standby_exact_readbacks >= 0 &&
        progress.standby_exact_readbacks <= 2 &&
        typeof progress.primary_fenced === "boolean" &&
        typeof progress.primary_stop_verified === "boolean" &&
        Number.isSafeInteger(progress.terminal_sample_count) &&
        progress.terminal_sample_count >= 0 &&
        progress.terminal_sample_count <= 3 &&
        [
          progress.cordoned_app_ids,
          progress.fenced_app_ids,
          progress.stopped_app_ids,
        ].every((ids) =>
          Array.isArray(ids) && new Set(ids).size === ids.length &&
          ids.every((id) => apps.includes(id))
        ),
      "producer_authority_progress",
    );
    return progress;
  };
  const producerProgressIndex = (wal: Row): number => {
    const roles = producerRoles(
      row(wal.context, "producer_authority_context").roles,
    );
    const apps = producerAppIDs(roles);
    const progress = producerProgress(wal);
    if (!progress.standby_fenced) {
      require(
        progress.standby_exact_readbacks === 0 &&
          producerExactArray(progress.cordoned_app_ids, []) &&
          progress.primary_fenced === false &&
          progress.primary_stop_verified === false &&
          producerExactArray(progress.fenced_app_ids, []) &&
          producerExactArray(progress.stopped_app_ids, []),
        "producer_authority_progress",
      );
      return 0;
    }
    let index = 1;
    for (let count = 1; count <= 3; count += 1) {
      if (producerExactArray(progress.cordoned_app_ids, apps.slice(0, count))) {
        index = count + 1;
      }
    }
    require(
      producerExactArray(
        progress.cordoned_app_ids,
        apps.slice(0, Math.max(0, index - 1)),
      ),
      "producer_authority_progress",
    );
    if (progress.primary_fenced) {
      require(index === 4, "producer_authority_progress");
      index = 5;
    }
    for (let count = 1; count <= 3; count += 1) {
      if (producerExactArray(progress.fenced_app_ids, apps.slice(0, count))) {
        require(index >= 5, "producer_authority_progress");
        index = 5 + count;
      }
    }
    require(
      producerExactArray(
        progress.fenced_app_ids,
        apps.slice(0, Math.max(0, index - 5)),
      ),
      "producer_authority_progress",
    );
    const stoppedCount = progress.stopped_app_ids.length;
    require(
      (progress.standby_exact_readbacks === 0 ||
        progress.standby_exact_readbacks === 2) &&
        (index <= 1 || progress.standby_exact_readbacks === 2) &&
        producerExactArray(
          progress.stopped_app_ids,
          apps.slice(0, stoppedCount),
        ) &&
        (index < 5
          ? progress.primary_stop_verified === false && stoppedCount === 0
          : index === 5
          ? stoppedCount === 0
          : progress.primary_stop_verified === true &&
            (stoppedCount === index - 6 || stoppedCount === index - 5)),
      "producer_authority_progress",
    );
    return index;
  };
  const producerProjectedProgress = (wal: Row, index: number): Row => {
    require(
      Number.isSafeInteger(index) && index >= 0 && index <= 8,
      "producer_authority_progress",
    );
    const roles = producerRoles(
      row(wal.context, "producer_authority_context").roles,
    );
    const apps = producerAppIDs(roles);
    const prior = producerProgress(wal);
    return {
      standby_fenced: index >= 1,
      standby_exact_readbacks: prior.standby_exact_readbacks,
      cordoned_app_ids: apps.slice(0, Math.max(0, Math.min(3, index - 1))),
      primary_fenced: index >= 5,
      primary_stop_verified: prior.primary_stop_verified,
      fenced_app_ids: apps.slice(0, Math.max(0, index - 5)),
      stopped_app_ids: [...prior.stopped_app_ids],
      terminal_sample_count: prior.terminal_sample_count,
    };
  };
  const producerExactReadbackPair = (
    events: readonly Row[],
    action: string,
    role: string | null,
  ): boolean => {
    const pair = events.slice(-2);
    return pair.length === 2 &&
      pair.every((entry) =>
        entry.kind === "readback" && entry.action === action &&
        entry.role === role && entry.fleet_sha256 === pair[0]!.fleet_sha256
      );
  };
  const producerUnfinishedChild = (events: readonly Row[]): Row | null => {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const value = events[index]!;
      if (value.kind === "child_result") return null;
      if (value.kind === "child_started" || value.kind === "intent") {
        return value;
      }
    }
    return null;
  };
  const producerEventCheckpointMatches = (
    checkpoint: string,
    value: Row,
  ): boolean => {
    if (value.kind === "intent") {
      return checkpoint === `intent_${value.action}_${value.role}`;
    }
    if (value.kind === "child_started") {
      return checkpoint === `child_started_${value.action}_${value.role}`;
    }
    if (value.kind === "child_result") {
      return checkpoint ===
        (value.child_settlement_method === "observed"
          ? `child_settled_${value.action}_${value.role}`
          : `child_recovery_settled_${value.action}_${value.role}`);
    }
    if (value.kind === "failure") return checkpoint === "failed_or_uncertain";
    if (value.kind === "proof") {
      if (value.action === "terminal_readback" && value.role === null) {
        return /^terminal_fleet_sample_[123]$/.test(checkpoint);
      }
      return value.action === "terminal_drain" && value.role === null &&
        /^terminal_drain_sample_[123]$/.test(checkpoint);
    }
    const match = checkpoint.match(/^(.*)_readback_([12])$/);
    if (match === null) return false;
    const base = match[1]!;
    if (base === "pre_mutation_exact_prefix" || base === "recovery_prefix") {
      return value.action === "readback" && value.role === null;
    }
    const contracts = new Map<string, readonly [string, string]>([
      ["standby_fence_clear_edge", ["fence", "thinker_standby"]],
      ["standby_stop_two_exact_reads", ["stop", "thinker_standby"]],
      ["app_cordon_prefix_1", ["cordon", "app_lhr_1"]],
      ["app_cordon_prefix_2", ["cordon", "app_lhr_2"]],
      ["app_cordon_prefix_3", ["cordon", "app_cdg"]],
      ["primary_fence_clear_edge", ["fence", "thinker_primary"]],
      ["primary_stop", ["stop", "thinker_primary"]],
      ["app_fence_prefix_1", ["fence", "app_lhr_1"]],
      ["app_fence_prefix_2", ["fence", "app_lhr_2"]],
      ["app_fence_prefix_3", ["fence", "app_cdg"]],
      ["app_stop_prefix_1", ["stop", "app_lhr_1"]],
      ["app_stop_prefix_2", ["stop", "app_lhr_2"]],
      ["app_stop_prefix_3", ["stop", "app_cdg"]],
    ]);
    const expected = contracts.get(base);
    return expected !== undefined && value.action === expected[0] &&
      value.role === expected[1];
  };
  const producerChildArgv = (wal: Row, value: Row): string[] => {
    require(
      wal.context !== null && value.role !== null &&
        ["fence", "stop", "cordon"].includes(value.action),
      "producer_authority_event",
    );
    const roles = producerRoles(
      row(wal.context, "producer_authority_context").roles,
    );
    const id = producerRoleID(roles, value.role);
    if (value.action === "stop") {
      return [PRODUCER_FLY, "machine", "stop", id, "-a", "agenttool"];
    }
    if (value.action === "cordon") {
      require(value.role.startsWith("app_"), "producer_authority_event");
      return [PRODUCER_FLY, "machine", "cordon", id, "-a", "agenttool"];
    }
    const argv = [
      PRODUCER_FLY,
      "machine",
      "update",
      id,
      "-a",
      "agenttool",
      "--build-remote-only",
    ];
    if (value.role.startsWith("app_")) argv.push("--autostart=false");
    argv.push("--machine-config", PRODUCER_FENCED_RESTART);
    if (value.role === "thinker_primary" || value.role === "thinker_standby") {
      argv.push("--standby-for=");
    }
    argv.push(
      "--skip-health-checks",
      "--skip-start",
      "--wait-timeout",
      "300",
      "--yes",
    );
    return argv;
  };
  const producerValidateEvents = (wal: Row): void => {
    require(
      Array.isArray(wal.events) && wal.events.length <= 256,
      "producer_authority_event",
    );
    let pending: Row | null = null;
    let priorAt = wal.started_at;
    for (let index = 0; index < wal.events.length; index += 1) {
      const value = exact(wal.events[index], [
        "seq",
        "at",
        "kind",
        "action",
        "role",
        "target_sha256",
        "argv_sha256",
        "child_pid",
        "child_process_group",
        "child_exit_code",
        "child_timed_out",
        "child_settled",
        "child_settlement_method",
        "fleet_sha256",
        "code",
      ], "producer_authority_event");
      require(
        value.seq === index + 1 && producerTimestamp(value.at) &&
          timestampKey(value.at, "producer_authority_timestamp") >=
            timestampKey(priorAt, "producer_authority_timestamp") &&
          timestampKey(value.at, "producer_authority_timestamp") <=
            timestampKey(wal.updated_at, "producer_authority_timestamp") &&
          [
            "intent",
            "child_started",
            "child_result",
            "readback",
            "proof",
            "failure",
          ].includes(value.kind) &&
          [
            "fence",
            "stop",
            "cordon",
            "readback",
            "terminal_readback",
            "terminal_drain",
          ].includes(value.action) &&
          (value.role === null || [
            "app_lhr_1",
            "app_lhr_2",
            "app_cdg",
            "thinker_primary",
            "thinker_standby",
          ].includes(value.role)) &&
          (value.target_sha256 === null || validSHA(value.target_sha256)) &&
          (value.argv_sha256 === null || validSHA(value.argv_sha256)) &&
          (value.fleet_sha256 === null || validSHA(value.fleet_sha256)) &&
          (value.code === null ||
            PRODUCER_SAFE_FAILURE_CODES.includes(value.code)),
        "producer_authority_event",
      );
      priorAt = value.at;
      const noChildResult = value.child_exit_code === null &&
        value.child_timed_out === null && value.child_settled === null &&
        value.child_settlement_method === null;
      if (value.kind === "intent") {
        require(
          pending === null &&
            ["fence", "stop", "cordon"].includes(value.action) &&
            value.role !== null && validSHA(value.target_sha256) &&
            validSHA(value.argv_sha256) && value.child_pid === null &&
            value.child_process_group === null && noChildResult &&
            value.fleet_sha256 === null && value.code === null,
          "producer_authority_event",
        );
        pending = value;
      } else if (value.kind === "child_started") {
        require(
          pending?.kind === "intent" && value.action === pending.action &&
            value.role === pending.role &&
            value.target_sha256 === pending.target_sha256 &&
            value.argv_sha256 === pending.argv_sha256 &&
            Number.isSafeInteger(value.child_pid) && value.child_pid > 1 &&
            Number.isSafeInteger(value.child_process_group) &&
            value.child_process_group === value.child_pid && noChildResult &&
            value.fleet_sha256 === null && value.code === null,
          "producer_authority_event",
        );
        pending = value;
      } else if (value.kind === "child_result") {
        require(
          pending?.kind === "child_started" &&
            value.action === pending.action &&
            value.role === pending.role &&
            value.target_sha256 === pending.target_sha256 &&
            value.argv_sha256 === pending.argv_sha256 &&
            value.child_pid === null && value.child_process_group === null &&
            value.child_settled === true && value.fleet_sha256 === null &&
            value.code === null &&
            ((value.child_settlement_method === "observed" &&
              Number.isSafeInteger(value.child_exit_code) &&
              value.child_exit_code >= 0 && value.child_exit_code <= 255 &&
              typeof value.child_timed_out === "boolean") ||
              (value.child_settlement_method === "recovery_absence" &&
                value.child_exit_code === null &&
                value.child_timed_out === null)),
          "producer_authority_event",
        );
        pending = null;
      } else if (value.kind === "readback" || value.kind === "proof") {
        require(
          pending === null && value.target_sha256 === null &&
            value.argv_sha256 === null && value.child_pid === null &&
            value.child_process_group === null && noChildResult &&
            validSHA(value.fleet_sha256) && value.code === null,
          "producer_authority_event",
        );
      } else {
        require(
          value.kind === "failure" && value.action === "readback" &&
            value.role === null && value.target_sha256 === null &&
            value.argv_sha256 === null && value.child_pid === null &&
            value.child_process_group === null && noChildResult &&
            value.fleet_sha256 === null && value.code !== null,
          "producer_authority_event",
        );
      }
    }
  };
  const producerValidateArmedWal = (wal: Row): void => {
    const context = exact(wal.context, [
      "machine_map_sha256",
      "machine_set_sha256",
      "roles",
      "image",
      "restored_config_sha256_by_machine",
      "fenced_config_sha256_by_machine",
      "source_inventory_sha256",
      "journal_inventory_sha256",
      "cron_sha256",
    ], "producer_authority_context");
    const roles = producerRoles(context.roles);
    const ids = producerMachineIDs(roles);
    const image = exact(context.image, [
      "digest",
      "tag",
      "revision",
      "configImage",
      "fullImageRefSha256",
    ], "producer_authority_context");
    const restored = row(
      context.restored_config_sha256_by_machine,
      "producer_authority_context",
    );
    const fenced = row(
      context.fenced_config_sha256_by_machine,
      "producer_authority_context",
    );
    const sortedIDs = [...ids].sort((left, right) =>
      left < right ? -1 : left > right ? 1 : 0
    );
    require(
      validSHA(context.machine_map_sha256) &&
        context.machine_set_sha256 === digest(`${sortedIDs.join("\n")}\n`) &&
        image.revision === wal.source_revision &&
        typeof image.tag === "string" && image.tag.length > 0 &&
        image.tag.length <= 128 && /^[A-Za-z0-9_.-]+$/.test(image.tag) &&
        typeof image.digest === "string" &&
        /^sha256:[0-9a-f]{64}$/.test(image.digest) &&
        image.configImage ===
          `registry.fly.io/agenttool:${image.tag}@${image.digest}` &&
        validSHA(image.fullImageRefSha256) &&
        canonical(Object.keys(restored).sort()) === canonical(sortedIDs) &&
        canonical(Object.keys(fenced).sort()) === canonical(sortedIDs) &&
        Object.values(restored).every(validSHA) &&
        Object.values(fenced).every(validSHA) &&
        validSHA(context.source_inventory_sha256) &&
        validSHA(context.journal_inventory_sha256) &&
        validSHA(context.cron_sha256),
      "producer_authority_context",
    );
    const admission = exact(wal.admission, [
      "proof_started_at",
      "proof_completed_at",
      "journal_applied_file_count",
      "journal_endpoint_count",
      "journal_observation_count",
      "journal_endpoints_equal",
      "migration_applied_at",
      "definition_checks_verified",
      "data_invariants_verified",
      "remainder_affected_count",
      "authority_baseline_verified",
      "generation_absence_checks",
      "drain_sample_count",
      "full_audit_exact_hash_clear",
      "embedded_critical_contract_sha256",
      "local_state_sandwich_sha256",
      "deploy_receipt_inventory_sha256",
      "deploy_receipt_file_count",
      "application_time_quiescence_proven",
      "drain_continuous_quiescence_proven",
    ], "producer_authority_admission");
    require(
      producerTimestamp(admission.proof_started_at) &&
        producerTimestamp(admission.proof_completed_at) &&
        timestampKey(
            admission.proof_started_at,
            "producer_authority_timestamp",
          ) <=
          timestampKey(
            admission.proof_completed_at,
            "producer_authority_timestamp",
          ) &&
        admission.journal_applied_file_count === 177 &&
        admission.journal_endpoint_count === 2 &&
        admission.journal_observation_count === 4 &&
        admission.journal_endpoints_equal === true &&
        Array.isArray(admission.migration_applied_at) &&
        canonical(admission.migration_applied_at) ===
          canonical(EXPECTED_MIGRATION_APPLIED_AT) &&
        admission.definition_checks_verified === true &&
        admission.data_invariants_verified === true &&
        admission.remainder_affected_count === 0 &&
        admission.authority_baseline_verified === true &&
        admission.generation_absence_checks === 4 &&
        admission.drain_sample_count === 3 &&
        admission.full_audit_exact_hash_clear === true &&
        validSHA(admission.embedded_critical_contract_sha256) &&
        validSHA(admission.local_state_sandwich_sha256) &&
        validSHA(admission.deploy_receipt_inventory_sha256) &&
        admission.deploy_receipt_file_count === 17 &&
        admission.application_time_quiescence_proven === false &&
        admission.drain_continuous_quiescence_proven === false,
      "producer_authority_admission",
    );
    const progress = producerProgress(wal);
    const progressIndex = producerProgressIndex(wal);
    if (wal.terminal_proof !== null) {
      const proof = exact(wal.terminal_proof, [
        "recorded_at",
        "fleet_sha256",
        "fleet_sample_sha256",
        "drain_sample_sha256",
        "journal_sha256",
        "authority_sha256",
        "provider_absence_sha256",
        "maintenance_anchor_sha256",
        "armed_witness_sha256",
        "authorized_archive_path",
        "readmission_guard_raw_sha256",
        "readmission_guard_normalized_sha256",
        "capsule_retirement_pending",
      ], "producer_authority_terminal");
      require(
        producerTimestamp(proof.recorded_at) &&
          [
            "fleet_sha256",
            "fleet_sample_sha256",
            "drain_sample_sha256",
            "journal_sha256",
            "authority_sha256",
            "provider_absence_sha256",
            "maintenance_anchor_sha256",
            "armed_witness_sha256",
            "readmission_guard_raw_sha256",
            "readmission_guard_normalized_sha256",
          ].every((key) => validSHA(proof[key])) &&
          typeof proof.authorized_archive_path === "string" &&
          proof.capsule_retirement_pending === true &&
          progressIndex === 8 && progress.standby_exact_readbacks === 2 &&
          progress.primary_stop_verified === true &&
          producerExactArray(progress.stopped_app_ids, producerAppIDs(roles)) &&
          progress.terminal_sample_count === 3 &&
          (wal.recovery_capsule?.retired === false ||
            wal.status === "fenced_awaiting_protected_main_readmission"),
        "producer_authority_terminal",
      );
    } else {
      require(
        progress.terminal_sample_count === 0,
        "producer_authority_terminal",
      );
    }
    if (wal.status === "fenced_awaiting_protected_main_readmission") {
      require(
        wal.checkpoint === "fenced_awaiting_protected_main_readmission" &&
          wal.terminal_proof !== null &&
          wal.recovery_capsule?.retired === true &&
          progressIndex === 8 && progress.standby_exact_readbacks === 2 &&
          progress.primary_stop_verified === true &&
          producerExactArray(progress.stopped_app_ids, producerAppIDs(roles)) &&
          progress.terminal_sample_count === 3 && wal.failure === null,
        "producer_authority_terminal",
      );
    }
  };
  const producerValidateWalSemantic = (wal: Row): void => {
    require(
      [
        "active",
        "failed_or_uncertain",
        "fenced_awaiting_protected_main_readmission",
      ].includes(wal.status) && typeof wal.checkpoint === "string" &&
        wal.checkpoint.length > 0 && wal.checkpoint.length <= 128 &&
        /^[a-z0-9_]+$/.test(wal.checkpoint) &&
        typeof wal.mutation_armed === "boolean" &&
        Array.isArray(wal.events) && wal.events.length <= 256,
      "producer_authority_wal",
    );
    const progress = exact(wal.progress, [
      "standby_fenced",
      "standby_exact_readbacks",
      "cordoned_app_ids",
      "primary_fenced",
      "primary_stop_verified",
      "fenced_app_ids",
      "stopped_app_ids",
      "terminal_sample_count",
    ], "producer_authority_progress");
    producerValidateEvents(wal);
    if (wal.failure !== null) {
      const failure = exact(wal.failure, [
        "code",
        "checkpoint",
        "observed_at",
      ], "producer_authority_failure");
      require(
        PRODUCER_SAFE_FAILURE_CODES.includes(failure.code) &&
          typeof failure.checkpoint === "string" &&
          /^[a-z0-9_]+$/.test(failure.checkpoint) &&
          producerTimestamp(failure.observed_at),
        "producer_authority_failure",
      );
    }
    if (!wal.mutation_armed) {
      require(
        wal.context === null && wal.admission === null &&
          wal.recovery_capsule === null && wal.terminal_proof === null &&
          progress.standby_fenced === false &&
          progress.standby_exact_readbacks === 0 &&
          producerExactArray(progress.cordoned_app_ids, []) &&
          progress.primary_fenced === false &&
          progress.primary_stop_verified === false &&
          producerExactArray(progress.fenced_app_ids, []) &&
          producerExactArray(progress.stopped_app_ids, []) &&
          progress.terminal_sample_count === 0 &&
          !wal.events.some((entry: Row) =>
            entry.kind === "intent" &&
            ["fence", "stop", "cordon"].includes(entry.action)
          ),
        "producer_authority_wal",
      );
    } else {
      require(
        wal.context !== null && wal.admission !== null &&
          wal.recovery_capsule !== null,
        "producer_authority_wal",
      );
      producerValidateArmedWal(wal);
    }
  };
  const producerIntentAllowed = (previous: Row, value: Row): boolean => {
    if (previous.context === null || value.role === null) return false;
    if (!producerExactReadbackPair(previous.events, "readback", null)) {
      return false;
    }
    const priorEvents = previous.events.slice(0, -2);
    const index = producerProgressIndex(previous);
    if (value.action === "fence" && value.role === "thinker_standby") {
      return priorEvents.length === 0 ||
        producerExactReadbackPair(priorEvents, "readback", null);
    }
    if (value.action === "stop" && value.role === "thinker_standby") {
      return index >= 1 &&
        producerExactReadbackPair(priorEvents, "fence", "thinker_standby");
    }
    if (value.action === "cordon") {
      const roles = ["app_lhr_1", "app_lhr_2", "app_cdg"];
      return previous.progress.standby_exact_readbacks === 2 && index >= 1 &&
        index <= 3 && value.role === roles[index - 1];
    }
    if (value.action === "fence" && value.role === "thinker_primary") {
      return index === 4 && previous.progress.standby_exact_readbacks === 2;
    }
    if (value.action === "stop" && value.role === "thinker_primary") {
      return index === 5 && !previous.progress.primary_stop_verified;
    }
    const appRoles = ["app_lhr_1", "app_lhr_2", "app_cdg"];
    if (value.action === "fence" && value.role.startsWith("app_")) {
      return previous.progress.primary_stop_verified &&
        previous.progress.stopped_app_ids.length === index - 5 && index >= 5 &&
        index <= 7 && value.role === appRoles[index - 5];
    }
    if (value.action === "stop" && value.role.startsWith("app_")) {
      return index >= 6 && index <= 8 &&
        previous.progress.stopped_app_ids.length === index - 6 &&
        value.role === appRoles[index - 6];
    }
    return false;
  };
  const producerValidateTransition = (previous: Row, next: Row): void => {
    require(
      previous.status !== "fenced_awaiting_protected_main_readmission",
      "producer_authority_transition",
    );
    for (
      const key of [
        "schema",
        "run_id",
        "command",
        "source_revision",
        "source_tree",
        "operator_path",
        "operator_sha256",
        "operator_normalized_sha256",
        "readmission_target",
        "prior_audited_lineage",
        "readmission_guard",
        "started_at",
        "lock",
        "audit_evidence",
        "caveats",
      ]
    ) {
      require(
        canonical(previous[key]) === canonical(next[key]),
        "producer_authority_transition",
      );
    }
    require(
      next.ordinal === previous.ordinal + 1 &&
        timestampKey(next.updated_at, "producer_authority_timestamp") >=
          timestampKey(previous.updated_at, "producer_authority_timestamp") &&
        next.events.length >= previous.events.length &&
        next.events.length <= previous.events.length + 1 &&
        canonical(next.events.slice(0, previous.events.length)) ===
          canonical(previous.events) &&
        (!previous.mutation_armed || next.mutation_armed),
      "producer_authority_transition",
    );
    const eventsSame = next.events.length === previous.events.length;
    const progressBefore = canonical(previous.progress);
    const progressAfter = canonical(next.progress);
    const contextBefore = canonical(previous.context);
    const contextAfter = canonical(next.context);
    const admissionBefore = canonical(previous.admission);
    const admissionAfter = canonical(next.admission);
    const capsuleBefore = canonical(previous.recovery_capsule);
    const capsuleAfter = canonical(next.recovery_capsule);
    const terminalBefore = canonical(previous.terminal_proof);
    const terminalAfter = canonical(next.terminal_proof);
    if (!previous.mutation_armed && next.mutation_armed) {
      require(
        next.checkpoint === "armed_exact_526_before_first_mutation" &&
          previous.context === null && next.context !== null &&
          previous.admission === null && next.admission !== null &&
          previous.recovery_capsule === null &&
          next.recovery_capsule !== null &&
          next.recovery_capsule.retired === false && eventsSame &&
          progressBefore === progressAfter &&
          terminalBefore === terminalAfter &&
          next.status === "active" && next.failure === null,
        "producer_authority_transition",
      );
      return;
    }
    require(
      previous.mutation_armed === next.mutation_armed &&
        contextBefore === contextAfter && admissionBefore === admissionAfter,
      "producer_authority_transition",
    );
    if (!eventsSame) {
      const appended = next.events.at(-1)!;
      require(
        progressBefore === progressAfter && capsuleBefore === capsuleAfter &&
          terminalBefore === terminalAfter &&
          producerEventCheckpointMatches(next.checkpoint, appended),
        "producer_authority_transition",
      );
      if (appended.kind === "failure") {
        require(
          previous.failure === null &&
            next.checkpoint === "failed_or_uncertain" &&
            next.status === "failed_or_uncertain" && next.failure !== null &&
            next.failure.code === appended.code &&
            next.failure.checkpoint === previous.checkpoint,
          "producer_authority_transition",
        );
      } else {
        require(
          next.status === previous.status &&
            canonical(next.failure) === canonical(previous.failure),
          "producer_authority_transition",
        );
        if (
          ["intent", "child_started", "child_result"].includes(appended.kind)
        ) {
          const argv = producerChildArgv(next, appended);
          const roles = producerRoles(
            row(next.context, "producer_authority_context").roles,
          );
          require(
            appended.target_sha256 ===
                digest(producerRoleID(roles, appended.role)) &&
              appended.argv_sha256 === digest(canonical(argv)),
            "producer_authority_transition",
          );
        }
        if (appended.kind === "intent") {
          require(
            producerIntentAllowed(previous, appended),
            "producer_authority_transition",
          );
        } else if (appended.kind === "child_started") {
          require(
            previous.events.at(-1)?.kind === "intent",
            "producer_authority_transition",
          );
        } else if (appended.kind === "child_result") {
          const unfinished = producerUnfinishedChild(previous.events);
          require(
            unfinished?.kind === "child_started" &&
              (previous.events.at(-1)?.kind === "child_started" ||
                previous.events.at(-1)?.kind === "failure"),
            "producer_authority_transition",
          );
        } else if (appended.kind === "readback") {
          const pairMatch = next.checkpoint.match(/^(.*)_readback_([12])$/);
          require(pairMatch !== null, "producer_authority_transition");
          if (pairMatch![2] === "2") {
            const firstReadback = previous.events.at(-1)!;
            require(
              previous.checkpoint === `${pairMatch![1]}_readback_1` &&
                firstReadback.kind === "readback" &&
                firstReadback.action === appended.action &&
                firstReadback.role === appended.role &&
                firstReadback.fleet_sha256 === appended.fleet_sha256 &&
                producerTimestampMilliseconds(appended.at) -
                      producerTimestampMilliseconds(firstReadback.at) >=
                  PRODUCER_STABLE_FLEET_INTERVAL_MILLISECONDS,
              "producer_authority_transition",
            );
          }
        } else if (appended.kind === "proof") {
          require(
            producerProgressIndex(previous) === 8 &&
              previous.terminal_proof === null,
            "producer_authority_transition",
          );
          const sampleMatch = next.checkpoint.match(
            /^terminal_(fleet|drain)_sample_([123])$/,
          );
          require(sampleMatch !== null, "producer_authority_transition");
          const sample = Number(sampleMatch![2]);
          if (sampleMatch![1] === "fleet") {
            const priorSample = previous.events.at(-1);
            require(
              previous.progress.terminal_sample_count === 0 &&
                (sample === 1 ||
                  (previous.checkpoint ===
                      `terminal_drain_sample_${sample - 1}` &&
                    priorSample?.kind === "proof" &&
                    priorSample.action === "terminal_drain" &&
                    producerTimestampMilliseconds(appended.at) -
                          producerTimestampMilliseconds(priorSample.at) >=
                      PRODUCER_STABLE_DRAIN_INTERVAL_MILLISECONDS)),
              "producer_authority_transition",
            );
          } else {
            require(
              previous.checkpoint === `terminal_fleet_sample_${sample}` &&
                previous.events.at(-1)?.kind === "proof" &&
                previous.events.at(-1)?.action === "terminal_readback",
              "producer_authority_transition",
            );
          }
        }
      }
      return;
    }
    if (previous.terminal_proof === null && next.terminal_proof !== null) {
      const tail = previous.events.slice(-6);
      require(
        next.checkpoint ===
            "terminal_proof_recorded_capsule_retirement_pending" &&
          previous.checkpoint === "terminal_drain_sample_3" &&
          previous.progress.terminal_sample_count === 0 &&
          next.progress.terminal_sample_count === 3 &&
          canonical({ ...next.progress, terminal_sample_count: 0 }) ===
            canonical(previous.progress) &&
          tail.length === 6 &&
          tail.every((entry: Row, index: number) =>
            entry.kind === "proof" && entry.role === null &&
            entry.action ===
              (index % 2 === 0 ? "terminal_readback" : "terminal_drain")
          ) && capsuleBefore === capsuleAfter &&
          next.status === previous.status &&
          canonical(next.failure) === canonical(previous.failure),
        "producer_authority_transition",
      );
      return;
    }
    if (
      previous.recovery_capsule?.retired === false &&
      next.recovery_capsule?.retired === true
    ) {
      require(
        previous.terminal_proof !== null && terminalBefore === terminalAfter &&
          next.checkpoint === "fenced_awaiting_protected_main_readmission" &&
          next.status === "fenced_awaiting_protected_main_readmission" &&
          next.failure === null && progressBefore === progressAfter,
        "producer_authority_transition",
      );
      return;
    }
    require(
      capsuleBefore === capsuleAfter && terminalBefore === terminalAfter &&
        next.status === previous.status &&
        canonical(next.failure) === canonical(previous.failure),
      "producer_authority_transition",
    );
    if (previous.context !== null && next.context !== null) {
      require(
        producerProgressIndex(next) >= producerProgressIndex(previous) &&
          (!previous.progress.primary_stop_verified ||
            next.progress.primary_stop_verified) &&
          canonical(next.progress.stopped_app_ids.slice(
              0,
              previous.progress.stopped_app_ids.length,
            )) === canonical(previous.progress.stopped_app_ids) &&
          next.progress.standby_exact_readbacks >=
            previous.progress.standby_exact_readbacks &&
          next.progress.terminal_sample_count >=
            previous.progress.terminal_sample_count &&
          next.progress.terminal_sample_count <=
            previous.progress.terminal_sample_count + 1,
        "producer_authority_transition",
      );
    }
    const tail = next.events.slice(-2);
    require(
      tail.length === 2 &&
        tail.every((entry: Row) => entry.kind === "readback") &&
        tail[0]!.fleet_sha256 === tail[1]!.fleet_sha256,
      "producer_authority_transition",
    );
    const previousIndex = producerProgressIndex(previous);
    const nextIndex = producerProgressIndex(next);
    let expected = producerProjectedProgress(previous, previousIndex);
    if (next.checkpoint === "recovery_adopted_exact_contiguous_prefix") {
      require(
        nextIndex > previousIndex &&
          producerExactReadbackPair(next.events, "readback", null),
        "producer_authority_transition",
      );
      expected = producerProjectedProgress(previous, nextIndex);
    } else if (next.checkpoint === "standby_fence_clear_edge_verified") {
      const desired = Math.max(1, previousIndex);
      require(
        nextIndex === desired &&
          producerExactReadbackPair(next.events, "fence", "thinker_standby"),
        "producer_authority_transition",
      );
      expected = producerProjectedProgress(previous, desired);
    } else if (next.checkpoint === "standby_stop_two_exact_reads_verified") {
      const desired = Math.max(1, previousIndex);
      require(
        nextIndex === desired &&
          producerExactReadbackPair(next.events, "stop", "thinker_standby"),
        "producer_authority_transition",
      );
      expected = producerProjectedProgress(previous, desired);
      expected.standby_exact_readbacks = 2;
    } else {
      const transitions = new Map<string, {
        before: number;
        after: number;
        action: string;
        role: string;
      }>([
        ["app_cordon_prefix_1_verified", {
          before: 1,
          after: 2,
          action: "cordon",
          role: "app_lhr_1",
        }],
        ["app_cordon_prefix_2_verified", {
          before: 2,
          after: 3,
          action: "cordon",
          role: "app_lhr_2",
        }],
        ["app_cordon_prefix_3_verified", {
          before: 3,
          after: 4,
          action: "cordon",
          role: "app_cdg",
        }],
        ["primary_fence_clear_edge_verified", {
          before: 4,
          after: 5,
          action: "fence",
          role: "thinker_primary",
        }],
        ["primary_stop_verified", {
          before: 5,
          after: 5,
          action: "stop",
          role: "thinker_primary",
        }],
        ["app_fence_prefix_1_verified", {
          before: 5,
          after: 6,
          action: "fence",
          role: "app_lhr_1",
        }],
        ["app_stop_prefix_1_verified", {
          before: 6,
          after: 6,
          action: "stop",
          role: "app_lhr_1",
        }],
        ["app_fence_prefix_2_verified", {
          before: 6,
          after: 7,
          action: "fence",
          role: "app_lhr_2",
        }],
        ["app_stop_prefix_2_verified", {
          before: 7,
          after: 7,
          action: "stop",
          role: "app_lhr_2",
        }],
        ["app_fence_prefix_3_verified", {
          before: 7,
          after: 8,
          action: "fence",
          role: "app_cdg",
        }],
        ["app_stop_prefix_3_verified", {
          before: 8,
          after: 8,
          action: "stop",
          role: "app_cdg",
        }],
      ]);
      const transition = transitions.get(next.checkpoint);
      require(
        transition !== undefined && previousIndex === transition.before &&
          nextIndex === transition.after &&
          producerExactReadbackPair(
            next.events,
            transition.action,
            transition.role,
          ),
        "producer_authority_transition",
      );
      expected = producerProjectedProgress(previous, transition!.after);
      if (next.checkpoint === "primary_stop_verified") {
        expected.primary_stop_verified = true;
      }
      const appStop = next.checkpoint.match(
        /^app_stop_prefix_([123])_verified$/,
      );
      if (appStop !== null) {
        const roles = producerRoles(
          row(previous.context, "producer_authority_context").roles,
        );
        expected.stopped_app_ids = producerAppIDs(roles).slice(
          0,
          Number(appStop[1]),
        );
      }
    }
    require(
      canonical(next.progress) === canonical(expected),
      "producer_authority_transition",
    );
  };
  const validateProducerAuthorityProjection = (
    request: ProducerAuthorityRequest,
  ): ProducerAuthorityProjection => {
    exact(
      request,
      ["receipt", "walRecords", "anchor", "witness"],
      "producer_authority_request",
    );
    exact(
      request.anchor,
      ["value", "sha256"],
      "producer_authority_request",
    );
    exact(
      request.witness,
      ["value", "sha256"],
      "producer_authority_request",
    );
    require(Array.isArray(request.walRecords), "producer_authority_request");
    const receipt = exact(request.receipt, [
      "schema",
      "run_id",
      "status",
      "source_revision",
      "source_tree",
      "operator_path",
      "operator_sha256",
      "operator_normalized_sha256",
      "operator_harness_sha256",
      "operator_normalization_contract",
      "readmission_target",
      "prior_audited_lineage",
      "audit_evidence",
      "started_at",
      "completed_at",
      "machine_set_sha256",
      "roles_sha256",
      "image_contract_sha256",
      "restored_config_map_sha256",
      "fenced_config_map_sha256",
      "wal_sha256_before_receipt",
      "terminal_wal_entry_filename",
      "terminal_wal_entry_sha256",
      "terminal_wal_ordinal",
      "terminal_checkpoint",
      "terminal_proof_recorded_wal_ordinal",
      "terminal_proof_recorded_wal_sha256",
      "wal_inventory",
      "maintenance_anchor_sha256",
      "maintenance_anchor_schema",
      "maintenance_anchor_run_id",
      "maintenance_anchor_handoff",
      "armed_witness",
      "terminal_fleet_sha256",
      "terminal_proof",
      "terminal_sample_count",
      "terminal_drain_sample_count",
      "terminal_interval_ms",
      "receipt_status_truthful",
      "maintenance_marker_retained",
      "armed_witness_retained",
      "recovery_capsule_retired",
      "recovery_capsule",
      "readmission_guard_raw_sha256",
      "readmission_guard_normalized_sha256",
      "deploy_or_start_attempt_count",
      "migration_attempt_count",
      "database_write_attempt_count",
      "secret_mutation_attempt_count",
      "uncordon_attempt_count",
      "rollback_attempt_count",
      "provider_generation_absence_revalidated_after_fence",
      "keychain_generation_absence_observed_before_mutation",
      "keychain_generation_absence_revalidated_after_fence",
      "keychain_generation_absence_after_fence",
      "journal_verified_after_fence",
      "authority_verified_after_fence",
      "drain_verified_after_fence",
      "application_actor",
      "application_path",
      "application_time_quiescence_proven",
      "historical_lineage_bound",
      "caveats",
    ], "producer_authority_receipt");
    const inventory = exact(
      receipt.wal_inventory,
      [
        "directory",
        "entry_count",
        "ordered_filenames",
        "entries",
        "first_entry_sha256",
        "terminal_entry_sha256",
        "chain_projection_sha256",
        "filename_set_sha256",
      ],
      "producer_authority_inventory",
    );
    const receiptCapsule = exact(
      receipt.recovery_capsule,
      [
        "path",
        "schema",
        "sha256",
        "retired",
        "retirement_wal_ordinal",
        "retirement_wal_sha256",
        "retirement_checkpoint",
      ],
      "producer_authority_capsule",
    );
    const audit = exact(receipt.audit_evidence, [
      "source_sha256",
      "source_normalized_sha256",
      "harness_sha256",
      "witness_sha256",
      "verified",
      "lineage_bound",
      "release_provenance_unbound",
      "snapshots_non_atomic",
      "release_created_at_order_safety_authority",
      "release_current_image_linkage_proven",
      "release_status_completion_authority",
      "release_stable_rollout_authority",
      "release_ledger_safety_authority",
      "release_history_complete",
      "release_history_may_be_truncated",
    ], "producer_authority_audit");
    const target = exact(receipt.readmission_target, [
      "protected_main_revision",
      "protected_main_tree",
      "clean_526_ancestor_distance",
    ], "producer_authority_target");
    require(
      Number.isSafeInteger(inventory.entry_count) &&
        request.walRecords.length === inventory.entry_count &&
        request.walRecords.length >= 4 && request.walRecords.length <= 512 &&
        typeof inventory.directory === "string" &&
        !inventory.directory.endsWith("/") &&
        receipt.schema ===
          "agenttool-phase-b-refence-observed-526-receipt/v1" &&
        validRunID(receipt.run_id) &&
        receipt.status === "fenced_awaiting_protected_main_readmission" &&
        validRevision(receipt.source_revision) &&
        validRevision(receipt.source_tree) &&
        validSHA(receipt.operator_sha256) &&
        validSHA(receipt.operator_normalized_sha256) &&
        validSHA(receipt.operator_harness_sha256) &&
        canonical(receipt.operator_normalization_contract) ===
          canonical(PRODUCER_NORMALIZATION_CONTRACT) &&
        validRevision(target.protected_main_revision) &&
        validRevision(target.protected_main_tree) &&
        Number.isSafeInteger(target.clean_526_ancestor_distance) &&
        target.clean_526_ancestor_distance > 12 &&
        validSHA(audit.source_sha256) &&
        validSHA(audit.source_normalized_sha256) &&
        validSHA(audit.harness_sha256) && validSHA(audit.witness_sha256) &&
        audit.verified === true && audit.lineage_bound === false &&
        audit.release_provenance_unbound === true &&
        audit.snapshots_non_atomic === true &&
        audit.release_created_at_order_safety_authority === false &&
        audit.release_current_image_linkage_proven === false &&
        audit.release_status_completion_authority === false &&
        audit.release_stable_rollout_authority === false &&
        audit.release_ledger_safety_authority === false &&
        audit.release_history_complete === false &&
        audit.release_history_may_be_truncated === true,
      "producer_authority_projection",
    );
    const caveats = canonical(PRODUCER_IMMUTABLE_CAVEATS);
    const capsulePath = inventory.directory + "/recovery-capsule.json";
    require(
      canonical(receipt.caveats) === caveats &&
        receipt.recovery_capsule_retired === true &&
        receiptCapsule.path === capsulePath &&
        receiptCapsule.schema ===
          "agenttool-phase-b-refence-observed-526-capsule/v1" &&
        validSHA(receiptCapsule.sha256) && receiptCapsule.retired === true &&
        receiptCapsule.retirement_wal_ordinal ===
          request.walRecords.length &&
        receiptCapsule.retirement_wal_ordinal ===
          receipt.terminal_wal_ordinal &&
        receiptCapsule.retirement_wal_sha256 ===
          inventory.terminal_entry_sha256 &&
        receiptCapsule.retirement_wal_sha256 ===
          receipt.terminal_wal_entry_sha256 &&
        receiptCapsule.retirement_checkpoint ===
          "fenced_awaiting_protected_main_readmission" &&
        receiptCapsule.retirement_checkpoint === receipt.terminal_checkpoint,
      "producer_authority_projection",
    );
    const inventoryEntries = inventory.entries;
    const orderedFilenames = inventory.ordered_filenames;
    const priorLineage = exact(receipt.prior_audited_lineage, [
      "protected_main_revision",
      "protected_main_tree",
      "clean_526_ancestor_distance",
      "evidence_only",
      "readmission_authority",
    ], "producer_authority_lineage");
    require(
      Array.isArray(inventoryEntries) &&
        inventoryEntries.length === request.walRecords.length &&
        Array.isArray(orderedFilenames) &&
        orderedFilenames.length === request.walRecords.length &&
        priorLineage.protected_main_revision ===
          "a4a80db6dd58855eda1727f06a78f72c683952d1" &&
        priorLineage.protected_main_tree ===
          "4a54b5f99e679a6aa5dede1649e2cc1fa257f983" &&
        priorLineage.clean_526_ancestor_distance === 12 &&
        priorLineage.evidence_only === true &&
        priorLineage.readmission_authority === false,
      "producer_authority_inventory",
    );
    let prior: string | null = null;
    let priorUpdatedAt: string | null = null;
    let immutableLock: string | null = null;
    let immutableContext: string | null = null;
    let immutableAdmission: string | null = null;
    let firstLock: Row | null = null;
    let firstGuard: Row | null = null;
    let previousWal: Row | null = null;
    let armedRecord: ProducerAuthorityRequest["walRecords"][number] | null =
      null;
    for (let index = 0; index < request.walRecords.length; index += 1) {
      const record = request.walRecords[index]!;
      exact(
        record,
        ["value", "sha256", "filename"],
        "producer_authority_request",
      );
      const wal = exact(
        record.value,
        [
          "schema",
          "ordinal",
          "prior_entry_sha256",
          "run_id",
          "command",
          "status",
          "checkpoint",
          "source_revision",
          "source_tree",
          "operator_path",
          "operator_sha256",
          "operator_normalized_sha256",
          "readmission_target",
          "readmission_guard",
          "prior_audited_lineage",
          "started_at",
          "updated_at",
          "mutation_armed",
          "lock",
          "audit_evidence",
          "recovery_capsule",
          "context",
          "admission",
          "progress",
          "events",
          "terminal_proof",
          "failure",
          "caveats",
        ],
        "producer_authority_wal",
      );
      const ordinal = index + 1;
      const projected = exact(
        inventoryEntries[index],
        [
          "ordinal",
          "filename",
          "sha256",
          "prior_entry_sha256",
          "checkpoint",
          "status",
          "mutation_armed",
        ],
        "producer_authority_inventory",
      );
      const expectedFilename = String(ordinal).padStart(6, "0") + "-" +
        record.sha256 + ".json";
      const lineage = exact(wal.prior_audited_lineage, [
        "protected_main_revision",
        "protected_main_tree",
        "clean_526_ancestor_distance",
        "evidence_only",
        "readmission_authority",
      ], "producer_authority_lineage");
      const lock = exact(wal.lock, [
        "owner_id",
        "owner_path",
        "pid",
        "device",
        "inode",
        "process_started_at",
        "process_argv_sha256",
      ], "producer_authority_lock");
      const guard = exact(wal.readmission_guard, [
        "path",
        "schema",
        "raw_sha256",
        "normalized_sha256",
      ], "producer_authority_guard");
      require(
        validSHA(record.sha256) && record.filename === expectedFilename &&
          wal.schema === "agenttool-phase-b-refence-observed-526-wal/v1" &&
          wal.ordinal === ordinal && wal.prior_entry_sha256 === prior &&
          wal.run_id === receipt.run_id &&
          wal.command === "refence-observed-526" &&
          wal.source_revision === receipt.source_revision &&
          wal.source_tree === receipt.source_tree &&
          wal.operator_path === receipt.operator_path &&
          wal.operator_sha256 === receipt.operator_sha256 &&
          wal.operator_normalized_sha256 ===
            receipt.operator_normalized_sha256 &&
          canonical(wal.readmission_target) ===
            canonical(receipt.readmission_target) &&
          canonical(lineage) === canonical(receipt.prior_audited_lineage) &&
          canonical(wal.audit_evidence) === canonical(receipt.audit_evidence) &&
          guard.path === PRODUCER_READMISSION_GUARD &&
          guard.schema ===
            "agenttool-phase-b-refence-maintenance-bridge/v1" &&
          validSHA(guard.raw_sha256) && validSHA(guard.normalized_sha256) &&
          guard.raw_sha256 === receipt.readmission_guard_raw_sha256 &&
          guard.normalized_sha256 ===
            receipt.readmission_guard_normalized_sha256 &&
          projected.ordinal === ordinal &&
          projected.filename === expectedFilename &&
          projected.sha256 === record.sha256 &&
          projected.prior_entry_sha256 === prior &&
          projected.checkpoint === wal.checkpoint &&
          projected.status === wal.status &&
          projected.mutation_armed === wal.mutation_armed &&
          orderedFilenames[index] === expectedFilename &&
          /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/
            .test(wal.started_at) &&
          /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/
            .test(wal.updated_at) &&
          timestampKey(wal.started_at, "producer_authority_timestamp") <=
            timestampKey(wal.updated_at, "producer_authority_timestamp") &&
          (priorUpdatedAt === null ||
            timestampKey(priorUpdatedAt, "producer_authority_timestamp") <=
              timestampKey(wal.updated_at, "producer_authority_timestamp")) &&
          Number.isSafeInteger(lock.pid) && lock.pid > 1 &&
          Number.isSafeInteger(lock.device) && lock.device > 0 &&
          Number.isSafeInteger(lock.inode) && lock.inode > 0 &&
          typeof lock.owner_id === "string" &&
          new RegExp(
            "^\\.phase-b-refence-lock-owner\\." + lock.pid +
              "\\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
          ).test(lock.owner_id) &&
          typeof lock.owner_path === "string" &&
          lock.owner_path.endsWith("/" + lock.owner_id) &&
          typeof lock.process_started_at === "string" &&
          /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (?: [1-9]|[12][0-9]|3[01]) [0-9]{2}:[0-9]{2}:[0-9]{2} [0-9]{4}$/
            .test(lock.process_started_at) &&
          validSHA(lock.process_argv_sha256),
        "producer_authority_wal",
      );
      producerValidateWalSemantic(wal);
      if (previousWal !== null) producerValidateTransition(previousWal, wal);
      require(
        canonical(wal.caveats) === caveats,
        "producer_authority_wal_caveats",
      );
      if (immutableLock === null) {
        immutableLock = canonical(lock);
        firstLock = lock;
        firstGuard = guard;
      }
      require(canonical(lock) === immutableLock, "producer_authority_lock");
      if (index === 0) {
        require(
          wal.ordinal === 1 && wal.mutation_armed === false &&
            wal.recovery_capsule === null && wal.context === null &&
            wal.admission === null && wal.terminal_proof === null &&
            wal.started_at === receipt.started_at &&
            wal.updated_at === wal.started_at && wal.status === "active" &&
            wal.checkpoint === "preparing_no_mutation_armed" &&
            wal.failure === null && Array.isArray(wal.events) &&
            wal.events.length === 0 && canonical(wal.progress) === canonical({
                standby_fenced: false,
                standby_exact_readbacks: 0,
                cordoned_app_ids: [],
                primary_fenced: false,
                primary_stop_verified: false,
                fenced_app_ids: [],
                stopped_app_ids: [],
                terminal_sample_count: 0,
              }),
          "producer_authority_wal_capsule",
        );
      } else {
        const capsule = exact(
          wal.recovery_capsule,
          ["path", "sha256", "retired"],
          "producer_authority_wal_capsule",
        );
        require(
          wal.mutation_armed === true && wal.context !== null &&
            wal.admission !== null && capsule.path === capsulePath &&
            capsule.sha256 === receiptCapsule.sha256 &&
            capsule.retired === (index === request.walRecords.length - 1),
          "producer_authority_wal_capsule",
        );
        if (armedRecord === null) {
          armedRecord = record;
          immutableContext = canonical(wal.context);
          immutableAdmission = canonical(wal.admission);
        }
        require(
          canonical(wal.context) === immutableContext &&
            canonical(wal.admission) === immutableAdmission &&
            (index < request.walRecords.length - 2
              ? wal.terminal_proof === null
              : wal.terminal_proof !== null),
          "producer_authority_armed_projection",
        );
        if (index === request.walRecords.length - 1) {
          require(
            canonical(wal.terminal_proof) ===
                canonical(
                  request.walRecords[index - 1]!.value.terminal_proof,
                ) &&
              wal.status ===
                "fenced_awaiting_protected_main_readmission" &&
              wal.checkpoint ===
                "fenced_awaiting_protected_main_readmission" &&
              wal.failure === null,
            "producer_authority_terminal",
          );
        }
      }
      prior = record.sha256;
      priorUpdatedAt = wal.updated_at;
      previousWal = wal;
    }
    const first = request.walRecords[0]!;
    const terminal = request.walRecords.at(-1)!;
    require(armedRecord !== null, "producer_authority_armed_projection");
    const armedAdmission = row(
      armedRecord!.value.admission,
      "producer_authority_admission",
    );
    require(
      producerTimestampMilliseconds(first.value.updated_at) <=
          producerTimestampMilliseconds(armedAdmission.proof_started_at) &&
        producerTimestampMilliseconds(armedAdmission.proof_started_at) <=
          producerTimestampMilliseconds(armedAdmission.proof_completed_at) &&
        producerTimestampMilliseconds(armedAdmission.proof_completed_at) <=
          producerTimestampMilliseconds(armedRecord!.value.updated_at) &&
        producerTimestampMilliseconds(armedAdmission.proof_completed_at) -
              producerTimestampMilliseconds(armedAdmission.proof_started_at) >=
          2 * PRODUCER_STABLE_DRAIN_INTERVAL_MILLISECONDS,
      "producer_authority_admission",
    );
    const anchor = exact(request.anchor.value, [
      "schema",
      "run_id",
      "source_revision",
      "source_tree",
      "wal_directory",
      "first_entry_filename",
      "first_entry_sha256",
      "created_at",
      "no_secret_values",
      "retained_until_protected_main_readmission",
      "terminal_status",
      "authorized_archive_path",
      "archive_handoff_method",
      "armed_witness_path",
      "armed_witness_schema",
      "armed_witness_authorized_archive_path",
      "armed_witness_archive_handoff_method",
      "readmission_target",
      "readmission_guard_path",
      "readmission_guard_schema",
      "readmission_guard_normalized_sha256",
      "guard_raw_sha256",
      "guard_raw_claimed",
    ], "producer_authority_anchor");
    const witness = exact(request.witness.value, [
      "schema",
      "run_id",
      "source_revision",
      "source_tree",
      "operator_path",
      "operator_sha256",
      "operator_normalized_sha256",
      "mutation_armed",
      "armed_wal_ordinal",
      "armed_wal_sha256",
      "armed_at",
      "deploy_lock_device",
      "deploy_lock_inode",
      "context_sha256",
      "admission_sha256",
      "recovery_capsule_reference_sha256",
      "no_secret_values",
      "retained_until_protected_main_readmission",
      "terminal_status",
      "authorized_archive_path",
      "archive_handoff_method",
      "readmission_target",
      "readmission_guard_path",
      "readmission_guard_schema",
      "readmission_guard_normalized_sha256",
      "guard_raw_sha256",
      "guard_raw_claimed",
    ], "producer_authority_witness");
    const handoff = exact(receipt.maintenance_anchor_handoff, [
      "source_path",
      "archive_path",
      "archive_required",
      "method",
      "archive_must_be_absent",
      "same_inode_and_hash_required",
      "directory_fsync_each_boundary",
      "silent_deletion_forbidden",
      "wrapper_window_open",
      "authorized_guard_path",
      "authorized_guard_schema",
      "authorized_consumer_marker_schema",
      "guard_raw_sha256",
      "guard_raw_claimed",
      "authorized_guard_normalized_sha256",
      "normalization_contract",
    ], "producer_authority_handoff");
    const receiptWitness = exact(receipt.armed_witness, [
      "path",
      "schema",
      "sha256",
      "run_id",
      "mutation_armed",
      "retained",
      "archive_path",
      "archive_required",
      "method",
      "archive_must_be_absent",
      "same_inode_and_hash_required",
      "directory_fsync_each_boundary",
      "silent_deletion_forbidden",
      "wrapper_window_open",
    ], "producer_authority_handoff");
    const witnessName = "phase-b-refence-observed-526-mutation-active.json";
    require(
      typeof receiptWitness.path === "string" &&
        receiptWitness.path.endsWith("/" + witnessName),
      "producer_authority_handoff",
    );
    const producerStateDirectory = receiptWitness.path.slice(
      0,
      -witnessName.length - 1,
    );
    const stateDirectory = producerStateDirectory.slice(
      0,
      producerStateDirectory.lastIndexOf("/"),
    );
    require(
      firstLock !== null && firstLock.owner_path ===
          stateDirectory + "/" + firstLock.owner_id &&
        firstGuard !== null &&
        inventory.directory === producerStateDirectory +
            "/phase-b-refence-observed-526-wal/" + receipt.run_id,
      "producer_authority_lock",
    );
    const armedWal = armedRecord!.value;
    const armedProgress = exact(armedWal.progress, [
      "standby_fenced",
      "standby_exact_readbacks",
      "cordoned_app_ids",
      "primary_fenced",
      "primary_stop_verified",
      "fenced_app_ids",
      "stopped_app_ids",
      "terminal_sample_count",
    ], "producer_authority_armed_projection");
    const terminalProof = exact(terminal.value.terminal_proof, [
      "recorded_at",
      "fleet_sha256",
      "fleet_sample_sha256",
      "drain_sample_sha256",
      "journal_sha256",
      "authority_sha256",
      "provider_absence_sha256",
      "maintenance_anchor_sha256",
      "armed_witness_sha256",
      "authorized_archive_path",
      "readmission_guard_raw_sha256",
      "readmission_guard_normalized_sha256",
      "capsule_retirement_pending",
    ], "producer_authority_terminal");
    const receiptTerminalProof = exact(receipt.terminal_proof, [
      "fleet_sample_sha256",
      "drain_sample_sha256",
      "journal_sha256",
      "authority_sha256",
      "provider_absence_sha256",
    ], "producer_authority_terminal");
    const terminalContext = row(
      terminal.value.context,
      "producer_authority_terminal",
    );
    const terminalEvents = terminal.value.events.slice(-6) as Row[];
    const terminalFleetFingerprints = terminalEvents
      .filter((_: Row, index: number) => index % 2 === 0)
      .map((event: Row) => event.fleet_sha256);
    const terminalDrainFingerprints = terminalEvents
      .filter((_: Row, index: number) => index % 2 === 1)
      .map((event: Row) => event.fleet_sha256);
    require(
      armedWal.ordinal === 2 &&
        armedWal.checkpoint === "armed_exact_526_before_first_mutation" &&
        armedWal.status === "active" && armedWal.terminal_proof === null &&
        armedWal.failure === null && Array.isArray(armedWal.events) &&
        armedWal.events.length === 0 &&
        armedProgress.standby_fenced === false &&
        armedProgress.standby_exact_readbacks === 0 &&
        Array.isArray(armedProgress.cordoned_app_ids) &&
        armedProgress.cordoned_app_ids.length === 0 &&
        armedProgress.primary_fenced === false &&
        armedProgress.primary_stop_verified === false &&
        Array.isArray(armedProgress.fenced_app_ids) &&
        armedProgress.fenced_app_ids.length === 0 &&
        Array.isArray(armedProgress.stopped_app_ids) &&
        armedProgress.stopped_app_ids.length === 0 &&
        armedProgress.terminal_sample_count === 0 &&
        request.walRecords.at(-2)!.value.checkpoint ===
          "terminal_proof_recorded_capsule_retirement_pending" &&
        receipt.terminal_proof_recorded_wal_ordinal ===
          request.walRecords.length - 1 &&
        receipt.terminal_proof_recorded_wal_sha256 ===
          request.walRecords.at(-2)!.sha256 &&
        terminalEvents.length === 6 &&
        terminalFleetFingerprints.length === 3 &&
        terminalFleetFingerprints.every((fingerprint) =>
          fingerprint === terminalFleetFingerprints[0]
        ) &&
        terminalDrainFingerprints.length === 3 &&
        terminalDrainFingerprints.every((fingerprint) =>
          fingerprint === terminalDrainFingerprints[0]
        ) &&
        terminalProof.fleet_sha256 === terminalFleetFingerprints[0] &&
        terminalProof.fleet_sample_sha256 ===
          digest(canonical(terminalFleetFingerprints)) &&
        timestampKey(
            terminalProof.recorded_at,
            "producer_authority_timestamp",
          ) >=
          timestampKey(
            terminalEvents.at(-1)!.at,
            "producer_authority_timestamp",
          ) &&
        timestampKey(
            terminalProof.recorded_at,
            "producer_authority_timestamp",
          ) <=
          timestampKey(
            request.walRecords.at(-2)!.value.updated_at,
            "producer_authority_timestamp",
          ) &&
        receiptTerminalProof.fleet_sample_sha256 ===
          terminalProof.fleet_sample_sha256 &&
        receiptTerminalProof.drain_sample_sha256 ===
          terminalProof.drain_sample_sha256 &&
        receiptTerminalProof.journal_sha256 === terminalProof.journal_sha256 &&
        receiptTerminalProof.authority_sha256 ===
          terminalProof.authority_sha256 &&
        receiptTerminalProof.provider_absence_sha256 ===
          terminalProof.provider_absence_sha256 &&
        terminalProof.authority_sha256 ===
          PRODUCER_TERMINAL_AUTHORITY_SHA256 &&
        terminalProof.provider_absence_sha256 ===
          PRODUCER_TERMINAL_PROVIDER_ABSENCE_SHA256 &&
        receipt.terminal_fleet_sha256 === terminalProof.fleet_sha256 &&
        receipt.machine_set_sha256 === terminalContext.machine_set_sha256 &&
        receipt.roles_sha256 === digest(canonical(terminalContext.roles)) &&
        receipt.image_contract_sha256 ===
          digest(canonical(terminalContext.image)) &&
        receipt.restored_config_map_sha256 === digest(canonical(
            terminalContext.restored_config_sha256_by_machine,
          )) &&
        receipt.fenced_config_map_sha256 === digest(canonical(
            terminalContext.fenced_config_sha256_by_machine,
          )),
      "producer_authority_terminal",
    );
    require(
      inventory.first_entry_sha256 === first.sha256 &&
        inventory.terminal_entry_sha256 === terminal.sha256 &&
        inventory.chain_projection_sha256 ===
          digest(canonical(inventoryEntries)) &&
        inventory.filename_set_sha256 ===
          digest(canonical(orderedFilenames)) &&
        receipt.wal_sha256_before_receipt === terminal.sha256 &&
        receipt.terminal_wal_entry_filename === terminal.filename &&
        receipt.terminal_wal_entry_sha256 === terminal.sha256 &&
        receipt.terminal_wal_ordinal === request.walRecords.length &&
        terminal.value.updated_at === receipt.completed_at &&
        request.anchor.sha256 === receipt.maintenance_anchor_sha256 &&
        anchor.schema ===
          "agenttool-phase-b-refence-observed-526-anchor/v1" &&
        anchor.run_id === receipt.run_id &&
        anchor.source_revision === receipt.source_revision &&
        anchor.source_tree === receipt.source_tree &&
        anchor.wal_directory === inventory.directory &&
        anchor.first_entry_filename === first.filename &&
        anchor.first_entry_sha256 === first.sha256 &&
        anchor.created_at === first.value.updated_at &&
        anchor.no_secret_values === true &&
        anchor.retained_until_protected_main_readmission === true &&
        anchor.terminal_status === receipt.status &&
        anchor.authorized_archive_path === handoff.archive_path &&
        anchor.archive_handoff_method === handoff.method &&
        anchor.armed_witness_path === receiptWitness.path &&
        anchor.armed_witness_schema === receiptWitness.schema &&
        anchor.armed_witness_authorized_archive_path ===
          receiptWitness.archive_path &&
        anchor.armed_witness_archive_handoff_method === receiptWitness.method &&
        canonical(anchor.readmission_target) ===
          canonical(receipt.readmission_target) &&
        anchor.readmission_guard_path === handoff.authorized_guard_path &&
        anchor.readmission_guard_schema === handoff.authorized_guard_schema &&
        anchor.readmission_guard_normalized_sha256 ===
          handoff.authorized_guard_normalized_sha256 &&
        anchor.guard_raw_sha256 === handoff.guard_raw_sha256 &&
        anchor.guard_raw_claimed === true,
      "producer_authority_anchor",
    );
    require(
      request.witness.sha256 === receiptWitness.sha256 &&
        witness.schema ===
          "agenttool-phase-b-refence-observed-526-armed-witness/v1" &&
        witness.run_id === receipt.run_id &&
        witness.source_revision === receipt.source_revision &&
        witness.source_tree === receipt.source_tree &&
        witness.operator_path === receipt.operator_path &&
        witness.operator_sha256 === receipt.operator_sha256 &&
        witness.operator_normalized_sha256 ===
          receipt.operator_normalized_sha256 &&
        witness.mutation_armed === true &&
        witness.armed_wal_ordinal === armedWal.ordinal &&
        witness.armed_wal_sha256 === armedRecord!.sha256 &&
        witness.armed_at === armedWal.updated_at &&
        witness.deploy_lock_device === armedWal.lock.device &&
        witness.deploy_lock_inode === armedWal.lock.inode &&
        witness.context_sha256 === digest(canonical(armedWal.context)) &&
        witness.admission_sha256 === digest(canonical(armedWal.admission)) &&
        witness.recovery_capsule_reference_sha256 ===
          digest(canonical(armedWal.recovery_capsule)) &&
        witness.no_secret_values === true &&
        witness.retained_until_protected_main_readmission === true &&
        witness.terminal_status === receipt.status &&
        witness.authorized_archive_path === receiptWitness.archive_path &&
        witness.archive_handoff_method === receiptWitness.method &&
        canonical(witness.readmission_target) ===
          canonical(receipt.readmission_target) &&
        witness.readmission_guard_path === handoff.authorized_guard_path &&
        witness.readmission_guard_schema === handoff.authorized_guard_schema &&
        witness.readmission_guard_normalized_sha256 ===
          handoff.authorized_guard_normalized_sha256 &&
        witness.guard_raw_sha256 === handoff.guard_raw_sha256 &&
        witness.guard_raw_claimed === true,
      "producer_authority_witness",
    );
    require(
      handoff.archive_required === true &&
        handoff.source_path === producerStateDirectory +
            "/maintenance-active.json" &&
        handoff.archive_path === producerStateDirectory +
            "/phase-b-refence-observed-526-anchor-retired-" + receipt.run_id +
            ".json" &&
        handoff.method === "exclusive_hardlink_then_unlink_canonical" &&
        handoff.archive_must_be_absent === true &&
        handoff.same_inode_and_hash_required === true &&
        handoff.directory_fsync_each_boundary === true &&
        handoff.silent_deletion_forbidden === true &&
        handoff.wrapper_window_open === false &&
        handoff.authorized_guard_schema ===
          "agenttool-phase-b-refence-maintenance-bridge/v1" &&
        firstGuard.path === handoff.authorized_guard_path &&
        firstGuard.schema === handoff.authorized_guard_schema &&
        handoff.authorized_consumer_marker_schema ===
          "agenttool-maintenance-refence-run/v1" &&
        handoff.guard_raw_sha256 === receipt.readmission_guard_raw_sha256 &&
        handoff.guard_raw_claimed === true &&
        handoff.authorized_guard_normalized_sha256 ===
          receipt.readmission_guard_normalized_sha256 &&
        handoff.normalization_contract ===
          "zero_only_bridge_self_normalized_sha256" &&
        receipt.maintenance_anchor_schema === anchor.schema &&
        receipt.maintenance_anchor_run_id === receipt.run_id &&
        receiptWitness.run_id === receipt.run_id &&
        receiptWitness.schema ===
          "agenttool-phase-b-refence-observed-526-armed-witness/v1" &&
        receiptWitness.archive_path === producerStateDirectory +
            "/phase-b-refence-observed-526-armed-witness-retired-" +
            receipt.run_id + ".json" &&
        receiptWitness.mutation_armed === true &&
        receiptWitness.retained === true &&
        receiptWitness.archive_required === true &&
        receiptWitness.method === "exclusive_hardlink_then_unlink_canonical" &&
        receiptWitness.archive_must_be_absent === true &&
        receiptWitness.same_inode_and_hash_required === true &&
        receiptWitness.directory_fsync_each_boundary === true &&
        receiptWitness.silent_deletion_forbidden === true &&
        receiptWitness.wrapper_window_open === false &&
        terminalProof.maintenance_anchor_sha256 === request.anchor.sha256 &&
        terminalProof.armed_witness_sha256 === request.witness.sha256 &&
        terminalProof.authorized_archive_path === handoff.archive_path &&
        terminalProof.readmission_guard_raw_sha256 ===
          handoff.guard_raw_sha256 &&
        terminalProof.readmission_guard_normalized_sha256 ===
          handoff.authorized_guard_normalized_sha256 &&
        terminalProof.capsule_retirement_pending === true &&
        receipt.terminal_sample_count === 3 &&
        receipt.terminal_drain_sample_count === 3 &&
        receipt.terminal_interval_ms === 5_137 &&
        receipt.receipt_status_truthful === true &&
        receipt.maintenance_marker_retained === true &&
        receipt.armed_witness_retained === true &&
        receipt.deploy_or_start_attempt_count === 0 &&
        receipt.migration_attempt_count === 0 &&
        receipt.database_write_attempt_count === 0 &&
        receipt.secret_mutation_attempt_count === 0 &&
        receipt.uncordon_attempt_count === 0 &&
        receipt.rollback_attempt_count === 0 &&
        receipt.provider_generation_absence_revalidated_after_fence === true &&
        receipt.keychain_generation_absence_observed_before_mutation === true &&
        receipt.keychain_generation_absence_revalidated_after_fence === false &&
        receipt.keychain_generation_absence_after_fence ===
          "unknown_not_requeried" &&
        receipt.journal_verified_after_fence === true &&
        receipt.authority_verified_after_fence === true &&
        receipt.drain_verified_after_fence === true &&
        receipt.application_actor === "unknown" &&
        receipt.application_path === "unknown" &&
        receipt.application_time_quiescence_proven === false &&
        receipt.historical_lineage_bound === false,
      "producer_authority_handoff",
    );
    return immutable({
      schema: "agenttool-phase-b-refence-producer-authority/v1",
      caveats_sha256: digest(caveats),
      recovery_capsule_path: capsulePath,
      recovery_capsule_sha256: receiptCapsule.sha256,
      wal_entry_count: request.walRecords.length,
      first_wal_sha256: first.sha256,
      terminal_wal_sha256: receiptCapsule.retirement_wal_sha256,
      prior_lineage_sha256: digest(canonical(receipt.prior_audited_lineage)),
      lock_sha256: digest(immutableLock!),
      context_sha256: digest(immutableContext!),
      admission_sha256: digest(immutableAdmission!),
      anchor_sha256: request.anchor.sha256,
      witness_sha256: request.witness.sha256,
      armed_wal_ordinal: armedWal.ordinal,
      armed_wal_sha256: armedRecord!.sha256,
    });
  };
  const databaseOriginStatementSHA256 = digest(
    canonical(DATABASE_ORIGIN_TRANSACTION_CONTRACT),
  );
  const validateDatabaseConvergenceMarker = (raw: unknown): void => {
    const value = exact(
      raw,
      DATABASE_CONVERGENCE_KEYS,
      "bridge_marker_database_convergence",
    );
    const status = value.status;
    const common = value.schema ===
        "agenttool-phase-b-refence-database-origin-convergence/v1" &&
      DATABASE_CONVERGENCE_STATUS.includes(status as string) &&
      typeof value.intent_durable === "boolean" &&
      typeof value.statement_attempted === "boolean" &&
      ["not_attempted", "unknown", "acknowledged"].includes(
        value.commit_state as string,
      ) && typeof value.verified === "boolean" &&
      typeof value.reconciliation_required === "boolean" &&
      [0, 1].includes(value.database_write_attempt_count) &&
      [0, 1].includes(value.rows_updated) &&
      value.rollback_attempt_count === 0 &&
      value.statement_sha256 === databaseOriginStatementSHA256 &&
      validSHA(value.database_target_sha256) &&
      validSHA(value.before_proof_sha256) &&
      value.before_instance_url_sha256 === PRE_REFENCE_INSTANCE_URL_SHA256 &&
      value.after_instance_url_sha256 === TARGET_INSTANCE_URL_SHA256 &&
      value.before_updated_at === EXPECTED_FEDERATION_UPDATED_AT;
    const nullableSHAKeys = [
      "after_proof_sha256",
      "before_row_sha256",
      "after_row_sha256",
      "unchanged_projection_sha256",
      "delta_sha256",
      "intent_wal_sha256",
      "commit_ack_wal_sha256",
      "verified_wal_sha256",
    ];
    const nullableTimestampKeys = [
      "after_updated_at",
      "clock_before",
      "clock_after",
    ];
    const nullableOrdinalKeys = [
      "intent_wal_ordinal",
      "commit_ack_wal_ordinal",
      "verified_wal_ordinal",
    ];
    require(
      common &&
        nullableSHAKeys.every((key) =>
          value[key] === null || validSHA(value[key])
        ) &&
        nullableTimestampKeys.every((key) => {
          if (value[key] === null) return true;
          try {
            timestampKey(value[key], "bridge_marker_database_convergence");
            return true;
          } catch {
            return false;
          }
        }) && nullableOrdinalKeys.every((key) =>
          value[key] === null ||
          (Number.isSafeInteger(value[key]) && value[key] > 0)
        ),
      "bridge_marker_database_convergence",
    );
    const nulls = (keys: readonly string[]): boolean =>
      keys.every((key) => value[key] === null);
    const resultKeys = [
      "after_proof_sha256",
      "before_row_sha256",
      "after_row_sha256",
      "unchanged_projection_sha256",
      "delta_sha256",
      "after_updated_at",
      "clock_before",
      "clock_after",
      "commit_ack_wal_ordinal",
      "commit_ack_wal_sha256",
      "verified_wal_ordinal",
      "verified_wal_sha256",
    ];
    if (status === "initial") {
      require(
        !value.intent_durable && !value.statement_attempted &&
          value.commit_state === "not_attempted" && !value.verified &&
          !value.reconciliation_required &&
          value.database_write_attempt_count === 0 &&
          value.rows_updated === 0 && value.intent_wal_ordinal === null &&
          value.intent_wal_sha256 === null && nulls(resultKeys),
        "bridge_marker_database_convergence",
      );
      return;
    }
    require(
      value.intent_durable && value.statement_attempted &&
        value.database_write_attempt_count === 1 &&
        Number.isSafeInteger(value.intent_wal_ordinal) &&
        validSHA(value.intent_wal_sha256),
      "bridge_marker_database_convergence",
    );
    if (status === "intent_unknown") {
      require(
        value.commit_state === "unknown" && !value.verified &&
          value.reconciliation_required && value.rows_updated === 0 &&
          nulls(resultKeys),
        "bridge_marker_database_convergence",
      );
      return;
    }
    const acknowledgedKeys = [
      "before_row_sha256",
      "after_row_sha256",
      "unchanged_projection_sha256",
      "delta_sha256",
      "after_updated_at",
      "clock_before",
      "clock_after",
      "commit_ack_wal_ordinal",
      "commit_ack_wal_sha256",
    ];
    require(
      value.commit_state === "acknowledged" && value.rows_updated === 1 &&
        acknowledgedKeys.every((key) => value[key] !== null) &&
        timestampKey(
            value.before_updated_at,
            "bridge_marker_database_convergence",
          ) <
          timestampKey(
            value.clock_before,
            "bridge_marker_database_convergence",
          ) &&
        timestampKey(
            value.clock_before,
            "bridge_marker_database_convergence",
          ) <=
          timestampKey(
            value.after_updated_at,
            "bridge_marker_database_convergence",
          ) &&
        timestampKey(
            value.after_updated_at,
            "bridge_marker_database_convergence",
          ) <=
          timestampKey(
            value.clock_after,
            "bridge_marker_database_convergence",
          ),
      "bridge_marker_database_convergence",
    );
    if (status === "commit_acknowledged") {
      require(
        !value.verified && value.reconciliation_required &&
          value.after_proof_sha256 === null &&
          value.verified_wal_ordinal === null &&
          value.verified_wal_sha256 === null,
        "bridge_marker_database_convergence",
      );
      return;
    }
    require(
      status === "verified" && value.verified &&
        !value.reconciliation_required && validSHA(value.after_proof_sha256) &&
        Number.isSafeInteger(value.verified_wal_ordinal) &&
        validSHA(value.verified_wal_sha256),
      "bridge_marker_database_convergence",
    );
  };
  const validateDatabaseConvergenceTransition = (
    currentRaw: unknown,
    nextRaw: unknown,
  ): void => {
    validateDatabaseConvergenceMarker(currentRaw);
    validateDatabaseConvergenceMarker(nextRaw);
    const current = currentRaw as Row;
    const next = nextRaw as Row;
    const currentRank = DATABASE_CONVERGENCE_STATUS.indexOf(
      current.status as string,
    );
    const nextRank = DATABASE_CONVERGENCE_STATUS.indexOf(next.status as string);
    require(
      nextRank === currentRank || nextRank === currentRank + 1,
      "bridge_marker_database_convergence_transition",
    );
    if (nextRank === currentRank) {
      require(
        canonical(next) === canonical(current),
        "bridge_marker_database_convergence_transition",
      );
      return;
    }
    const immutableKeys = [
      "schema",
      "rollback_attempt_count",
      "statement_sha256",
      "database_target_sha256",
      "before_proof_sha256",
      "before_instance_url_sha256",
      "after_instance_url_sha256",
      "before_updated_at",
    ];
    require(
      immutableKeys.every((key) => next[key] === current[key]),
      "bridge_marker_database_convergence_transition",
    );
  };
  const validateDatabaseOriginConvergence = (
    proof: DatabaseOriginConvergenceProof,
    before: DatabaseProof,
    after: DatabaseProof,
  ): { beforeProofSHA256: string; afterProofSHA256: string } => {
    exact(proof, [
      "schema",
      "statement_sha256",
      "database_target_sha256",
      "before_row_sha256",
      "after_row_sha256",
      "unchanged_projection_sha256",
      "delta_sha256",
      "before_instance_url_sha256",
      "after_instance_url_sha256",
      "before_updated_at",
      "after_updated_at",
      "clock_before",
      "clock_after",
      "database_write_attempt_count",
      "rows_updated",
      "commit_acknowledged",
      "commit_ambiguity",
      "rollback_attempt_count",
    ], "database_convergence_proof");
    const beforeProjection = structuredClone(before) as Row;
    const afterProjection = structuredClone(after) as Row;
    delete beforeProjection.federation_instance_url_sha256;
    delete beforeProjection.federation_updated_at;
    delete afterProjection.federation_instance_url_sha256;
    delete afterProjection.federation_updated_at;
    require(
      proof.schema ===
          "agenttool-phase-b-refence-database-origin-convergence/v1" &&
        proof.statement_sha256 === databaseOriginStatementSHA256 &&
        validSHA(proof.database_target_sha256) &&
        [
          proof.before_row_sha256,
          proof.after_row_sha256,
          proof.unchanged_projection_sha256,
          proof.delta_sha256,
        ].every(validSHA) &&
        proof.before_instance_url_sha256 === PRE_REFENCE_INSTANCE_URL_SHA256 &&
        proof.after_instance_url_sha256 === TARGET_INSTANCE_URL_SHA256 &&
        proof.before_updated_at === EXPECTED_FEDERATION_UPDATED_AT &&
        timestampKey(proof.before_updated_at, "database_convergence_proof") <
          timestampKey(proof.clock_before, "database_convergence_proof") &&
        timestampKey(proof.clock_before, "database_convergence_proof") <=
          timestampKey(proof.after_updated_at, "database_convergence_proof") &&
        timestampKey(proof.after_updated_at, "database_convergence_proof") <=
          timestampKey(proof.clock_after, "database_convergence_proof") &&
        proof.database_write_attempt_count === 1 && proof.rows_updated === 1 &&
        proof.commit_acknowledged === true &&
        proof.commit_ambiguity === false &&
        proof.rollback_attempt_count === 0 &&
        proof.delta_sha256 === digest(canonical({
            after_instance_url_sha256: TARGET_INSTANCE_URL_SHA256,
            after_updated_at: proof.after_updated_at,
            before_instance_url_sha256: PRE_REFENCE_INSTANCE_URL_SHA256,
            before_updated_at: EXPECTED_FEDERATION_UPDATED_AT,
            clock_after: proof.clock_after,
            clock_before: proof.clock_before,
          })) &&
        before.federation_instance_url_sha256 ===
          PRE_REFENCE_INSTANCE_URL_SHA256 &&
        before.federation_updated_at === EXPECTED_FEDERATION_UPDATED_AT &&
        after.federation_instance_url_sha256 === TARGET_INSTANCE_URL_SHA256 &&
        after.federation_updated_at === proof.after_updated_at &&
        before.database_target_sha256 === proof.database_target_sha256 &&
        after.database_target_sha256 === proof.database_target_sha256 &&
        canonical(beforeProjection) === canonical(afterProjection),
      "database_convergence_proof",
    );
    return {
      beforeProofSHA256: digest(canonical(before)),
      afterProofSHA256: digest(canonical(after)),
    };
  };
  const validateProducerDatabaseAuthority = (
    value: DatabaseProof,
    evidence: ContractEvidence | null,
    code: string,
  ): void => {
    const authority = exact(value.producer_authority, [
      "source_migrations",
      "terminal_journal",
      "terminal_drain_snapshots",
    ], code);
    require(
      Array.isArray(authority.source_migrations) &&
        authority.source_migrations.length === EXPECTED_JOURNAL_FILE_COUNT,
      code,
    );
    const source = authority.source_migrations.map((raw: unknown) => {
      const migration = exact(raw, ["checksum", "filename"], code);
      require(
        typeof migration.filename === "string" &&
          /^(?:[0-9]{4}|[0-9]{8}T[0-9]{6})_[a-z0-9_]+\.sql$/.test(
            migration.filename,
          ) && validSHA(migration.checksum),
        code,
      );
      return { filename: migration.filename, checksum: migration.checksum };
    });
    require(
      source.every((entry, index) =>
        index === 0 || source[index - 1]!.filename < entry.filename
      ) &&
        new Set(source.map((entry) => entry.filename)).size === source.length &&
        digest(canonical(source)) === value.source_inventory_sha256 &&
        (evidence === null ||
          value.source_inventory_sha256 === evidence.sourceInventorySHA256),
      code,
    );
    const terminalJournal = exact(
      authority.terminal_journal,
      ["session", "transaction"],
      code,
    );
    const journalProof = (raw: unknown): Row => {
      const proof = exact(raw, ["rows", "targetAppliedAt"], code);
      require(
        Array.isArray(proof.rows) && proof.rows.length === source.length &&
          Array.isArray(proof.targetAppliedAt) &&
          canonical(proof.targetAppliedAt) ===
            canonical(EXPECTED_MIGRATION_APPLIED_AT),
        code,
      );
      const rows = proof.rows.map((entry: unknown, index: number) => {
        const row = exact(entry, ["applied_at", "checksum", "filename"], code);
        require(
          row.filename === source[index]!.filename &&
            row.checksum === source[index]!.checksum &&
            typeof row.applied_at === "string",
          code,
        );
        timestampKey(row.applied_at, code);
        return row;
      });
      require(
        digest(canonical(rows)) === value.journal_inventory_sha256 &&
          (evidence === null ||
            value.journal_inventory_sha256 === evidence.journalInventorySHA256),
        code,
      );
      return { rows, targetAppliedAt: proof.targetAppliedAt };
    };
    const transaction = journalProof(terminalJournal.transaction);
    const session = journalProof(terminalJournal.session);
    require(canonical(transaction) === canonical(session), code);
    require(
      Array.isArray(authority.terminal_drain_snapshots) &&
        authority.terminal_drain_snapshots.length === 3,
      code,
    );
    const snapshots = authority.terminal_drain_snapshots.map(
      (entry: unknown): Row => {
        const snapshot = exact(
          entry,
          ["counts", "cron_sha256", "informational"],
          code,
        );
        const counts = exact(snapshot.counts, PRODUCER_ZERO_DRAIN_FIELDS, code);
        const informational = exact(
          snapshot.informational,
          ["payout_requested", "x402_inserted"],
          code,
        );
        require(
          PRODUCER_ZERO_DRAIN_FIELDS.every((field) => counts[field] === 0) &&
            Number.isSafeInteger(informational.payout_requested) &&
            informational.payout_requested >= 0 &&
            Number.isSafeInteger(informational.x402_inserted) &&
            informational.x402_inserted >= 0 &&
            snapshot.cron_sha256 === EXPECTED_CRON_SHA256 &&
            (evidence === null || snapshot.cron_sha256 === evidence.cronSHA256),
          code,
        );
        return { counts, informational, cron_sha256: snapshot.cron_sha256 };
      },
    );
    require(
      snapshots.every((snapshot) =>
        canonical(snapshot.informational) ===
          canonical(snapshots[0]!.informational)
      ),
      code,
    );
  };
  const validateDatabaseProof = (
    raw: unknown,
    evidence: ContractEvidence,
    expectedOrigin: { instanceURLSHA256: string; updatedAt: string },
  ): DatabaseProof => {
    const value = exact(
      raw,
      DATABASE_PROOF_KEYS,
      "database_proof",
    ) as unknown as DatabaseProof;
    exact(
      value.drain_informational,
      ["payout_requested", "x402_inserted"],
      "database_proof",
    );
    timestampKey(expectedOrigin.updatedAt, "database_proof");
    validateProducerDatabaseAuthority(value, evidence, "database_proof");
    require(
      value.source_inventory_sha256 === evidence.sourceInventorySHA256 &&
        value.journal_file_count === EXPECTED_JOURNAL_FILE_COUNT &&
        value.journal_endpoint_count === 2 &&
        value.journal_observation_count === 4 &&
        value.journal_inventory_sha256 === evidence.journalInventorySHA256 &&
        canonical(value.target_migration_applied_at) ===
          canonical(EXPECTED_MIGRATION_APPLIED_AT) &&
        value.migration_definitions_verified === true &&
        value.migration_data_verified === true &&
        value.remainder_affected_count === 0 &&
        value.federation_disabled === true &&
        [PRE_REFENCE_INSTANCE_URL_SHA256, TARGET_INSTANCE_URL_SHA256].includes(
          expectedOrigin.instanceURLSHA256,
        ) && value.federation_instance_url_sha256 ===
          expectedOrigin.instanceURLSHA256 &&
        value.federation_updated_at === expectedOrigin.updatedAt &&
        value.durable_hold === false && value.allowed_origins_count === 0 &&
        value.reserved_generation_rows === 0 &&
        value.authoritative_v2_rows === 0 && value.received_v1_rows === 0 &&
        value.drain_sample_count === 3 &&
        Number.isSafeInteger(value.drain_informational.payout_requested) &&
        value.drain_informational.payout_requested >= 0 &&
        Number.isSafeInteger(value.drain_informational.x402_inserted) &&
        value.drain_informational.x402_inserted >= 0 &&
        value.drain_zero === true &&
        value.cron_sha256 === EXPECTED_CRON_SHA256 &&
        value.cron_sha256 === evidence.cronSHA256 &&
        validSHA(value.database_target_sha256),
      "database_proof",
    );
    return value;
  };
  const validateDatabaseConvergenceInheritedProof = (
    raw: unknown,
  ): DatabaseProof => {
    const value = exact(
      raw,
      DATABASE_PROOF_KEYS,
      "database_convergence_admission",
    ) as unknown as DatabaseProof;
    exact(
      value.drain_informational,
      ["payout_requested", "x402_inserted"],
      "database_convergence_admission",
    );
    timestampKey(value.federation_updated_at, "database_convergence_admission");
    validateProducerDatabaseAuthority(
      value,
      null,
      "database_convergence_admission",
    );
    require(
      validSHA(value.source_inventory_sha256) &&
        value.journal_file_count === EXPECTED_JOURNAL_FILE_COUNT &&
        value.journal_endpoint_count === 2 &&
        value.journal_observation_count === 4 &&
        validSHA(value.journal_inventory_sha256) &&
        canonical(value.target_migration_applied_at) ===
          canonical(EXPECTED_MIGRATION_APPLIED_AT) &&
        value.migration_definitions_verified === true &&
        value.migration_data_verified === true &&
        value.remainder_affected_count === 0 &&
        value.federation_disabled === true &&
        value.federation_instance_url_sha256 ===
          PRE_REFENCE_INSTANCE_URL_SHA256 &&
        value.federation_updated_at === EXPECTED_FEDERATION_UPDATED_AT &&
        value.durable_hold === false && value.allowed_origins_count === 0 &&
        value.reserved_generation_rows === 0 &&
        value.authoritative_v2_rows === 0 && value.received_v1_rows === 0 &&
        value.drain_sample_count === 3 &&
        Number.isSafeInteger(value.drain_informational.payout_requested) &&
        value.drain_informational.payout_requested >= 0 &&
        Number.isSafeInteger(value.drain_informational.x402_inserted) &&
        value.drain_informational.x402_inserted >= 0 &&
        value.drain_zero === true &&
        value.cron_sha256 === EXPECTED_CRON_SHA256 &&
        validSHA(value.database_target_sha256),
      "database_convergence_admission",
    );
    return value;
  };
  const validateControllerWalEntry = (
    value: ControllerWalContractEntry,
    previous: ControllerWalContractEntry | null,
    history: readonly ControllerWalContractEntry[],
    expected: {
      controllerRunID: string;
      rolloutID: string;
      receiptSHA256: string;
    },
  ): void => {
    exact(value, CONTROLLER_WAL_KEYS, "controller_wal_shape");
    timestampKey(value.recorded_at, "controller_wal_contract");
    require(
      value.schema ===
          "agenttool-phase-b-refence-maintenance-child-wal/v1" &&
        value.ordinal === (previous?.ordinal ?? 0) + 1 &&
        (value.prior_entry_sha256 === null) === (previous === null) &&
        validRunID(value.controller_run_id) &&
        value.controller_run_id === expected.controllerRunID &&
        /^maintenance-refence-[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{16}$/
          .test(value.rollout_id) &&
        value.rollout_id === expected.rolloutID &&
        validSHA(value.receipt_sha256) &&
        value.receipt_sha256 === expected.receiptSHA256 &&
        /^[a-z0-9_]{1,128}$/.test(value.checkpoint) &&
        [
          "ready",
          "attempting",
          "spawned",
          "settled",
          "verified",
          "transition_verified",
          "failed_or_uncertain",
          "complete",
        ].includes(value.phase) &&
        typeof value.local_process_group_settled === "boolean",
      "controller_wal_contract",
    );
    if (previous !== null) {
      require(
        value.prior_entry_sha256 === digest(`${canonical(previous)}\n`),
        "controller_wal_chain",
      );
    }
    require(
      [
        value.argv_sha256,
        value.provider_transition_sha256,
        value.fleet_readback_sha256,
        value.detail_sha256,
      ].every((entry) => entry === null || validSHA(entry)) &&
        (value.failure_code === null ||
          /^[a-z0-9_]{1,64}$/.test(value.failure_code)),
      "controller_wal_contract",
    );
    if (value.phase === "ready" || value.phase === "complete") {
      require(
        value.effect_id === null && value.effect_kind === null &&
          value.target === null && value.argv_sha256 === null &&
          value.pid === null && value.pgid === null &&
          value.exit_code === null && value.termination === null &&
          value.provider_transition_sha256 === null &&
          value.fleet_readback_sha256 === null &&
          value.failure_code === null && value.local_process_group_settled,
        "controller_wal_phase",
      );
      require(
        value.phase !== "ready" || previous === null,
        "controller_wal_phase",
      );
      if (value.phase === "complete") {
        require(
          previous?.phase === "verified" ||
            previous?.phase === "transition_verified",
          "controller_wal_phase",
        );
      }
      return;
    }
    require(
      typeof value.effect_id === "string" &&
        /^[a-z0-9_]{1,128}$/.test(value.effect_id) &&
        [
          "build_push",
          "database_convergence",
          "update_image",
          "restore_config",
          "refence_config",
          "start_machine",
          "enable_autostart",
          "uncordon_machine",
          "cordon_machine",
          "stop_machine",
          "wait_machine",
          "read_fleet",
          "read_secrets",
          "read_git",
          "read_keychain",
          "read_process",
          "public_probe",
          "ordinary_postflight",
          "runtime_probe",
        ].includes(value.effect_kind ?? "") &&
        typeof value.target === "string" && value.target.length >= 1 &&
        value.target.length <= 256 && validSHA(value.argv_sha256),
      "controller_wal_effect",
    );
    const transitionFailure = value.phase === "failed_or_uncertain" &&
      previous?.phase === "verified" &&
      previous.effect_kind === "read_fleet" &&
      value.effect_id !== previous.effect_id;
    const databaseConvergence = value.effect_kind === "database_convergence";
    if (value.phase === "attempting") {
      require(
        previous !== null &&
          ["ready", "settled", "verified", "transition_verified"].includes(
            previous.phase,
          ) && value.pid === null && value.pgid === null &&
          value.exit_code === null && value.termination === null &&
          value.local_process_group_settled === databaseConvergence &&
          value.provider_transition_sha256 === null &&
          value.fleet_readback_sha256 === null && value.failure_code === null,
        "controller_wal_phase",
      );
    } else if (value.phase !== "transition_verified" && !transitionFailure) {
      require(
        previous !== null && value.effect_id === previous.effect_id &&
          value.effect_kind === previous.effect_kind &&
          value.target === previous.target &&
          value.argv_sha256 === previous.argv_sha256,
        "controller_wal_effect_chain",
      );
    }
    if (value.phase === "spawned") {
      require(
        !databaseConvergence && previous?.phase === "attempting" &&
          Number.isSafeInteger(value.pid) && value.pid! > 1 &&
          value.pgid === value.pid && value.exit_code === null &&
          value.termination === null && !value.local_process_group_settled &&
          value.provider_transition_sha256 === null &&
          value.fleet_readback_sha256 === null && value.failure_code === null,
        "controller_wal_phase",
      );
    }
    if (value.phase === "settled") {
      if (databaseConvergence) {
        require(
          previous?.phase === "attempting" && value.pid === null &&
            value.pgid === null && value.exit_code === null &&
            value.termination === null && value.local_process_group_settled &&
            value.provider_transition_sha256 === null &&
            value.fleet_readback_sha256 === null &&
            validSHA(value.detail_sha256) && value.failure_code === null,
          "controller_wal_phase",
        );
      } else {
        require(
          previous?.phase === "spawned" && value.pid === previous.pid &&
            value.pgid === previous.pgid &&
            Number.isSafeInteger(value.exit_code) &&
            value.exit_code! >= 0 && value.exit_code! <= 255 &&
            value.termination === "exit" && value.local_process_group_settled &&
            value.provider_transition_sha256 === null &&
            value.fleet_readback_sha256 === null && value.failure_code === null,
          "controller_wal_phase",
        );
      }
    }
    if (value.phase === "verified") {
      if (databaseConvergence) {
        require(
          previous?.phase === "settled" && value.pid === null &&
            value.pgid === null && value.exit_code === null &&
            value.termination === null && value.local_process_group_settled &&
            validSHA(value.provider_transition_sha256) &&
            validSHA(value.fleet_readback_sha256) &&
            validSHA(value.detail_sha256) && value.failure_code === null,
          "controller_wal_phase",
        );
      } else {
        require(
          previous?.phase === "settled" && value.pid === previous.pid &&
            value.pgid === previous.pgid &&
            value.exit_code === previous.exit_code &&
            Number.isSafeInteger(value.exit_code) &&
            value.termination === "exit" && value.local_process_group_settled &&
            validSHA(value.provider_transition_sha256) &&
            validSHA(value.fleet_readback_sha256) &&
            value.failure_code === null,
          "controller_wal_phase",
        );
      }
    }
    if (value.phase === "transition_verified") {
      const subject = [...history].reverse().find((entry) =>
        entry.effect_id === value.effect_id && entry.phase === "settled"
      );
      const fleetReads = history.filter((entry) =>
        entry.phase === "verified" && entry.effect_kind === "read_fleet"
      ).slice(-2);
      require(
        subject !== undefined && previous !== null &&
          previous.phase === "verified" &&
          previous.effect_kind === "read_fleet" && fleetReads.length === 2 &&
          fleetReads[1] === previous &&
          fleetReads[0]!.effect_id !== fleetReads[1]!.effect_id &&
          fleetReads.every((entry) =>
            entry.fleet_readback_sha256 === value.fleet_readback_sha256
          ) && value.effect_kind === subject.effect_kind &&
          value.target === subject.target &&
          value.argv_sha256 === subject.argv_sha256 &&
          value.pid === subject.pid && value.pgid === subject.pgid &&
          value.exit_code === 0 && value.termination === "exit" &&
          value.local_process_group_settled &&
          validSHA(value.provider_transition_sha256) &&
          validSHA(value.fleet_readback_sha256) &&
          value.failure_code === null &&
          !history.some((entry) =>
            entry.effect_id === value.effect_id &&
            entry.phase === "transition_verified"
          ),
        "controller_wal_phase",
      );
    }
    if (value.phase === "failed_or_uncertain") {
      if (transitionFailure) {
        const subject = [...history].reverse().find((entry) =>
          entry.effect_id === value.effect_id && entry.phase === "settled"
        );
        const fleetReads = history.filter((entry) =>
          entry.phase === "verified" && entry.effect_kind === "read_fleet"
        ).slice(-2);
        const effectPrefix = subject?.effect_id?.match(
          /^(effect_[0-9]{6})_[a-z0-9_]+$/,
        )?.[1];
        require(
          subject !== undefined && effectPrefix !== undefined &&
            fleetReads.length === 2 && fleetReads[1] === previous &&
            fleetReads[0]!.effect_id === `${effectPrefix}_post_read_1` &&
            fleetReads[1]!.effect_id === `${effectPrefix}_post_read_2` &&
            subject.ordinal < fleetReads[0]!.ordinal &&
            value.effect_kind === subject.effect_kind &&
            value.target === subject.target &&
            value.argv_sha256 === subject.argv_sha256 &&
            value.pid === subject.pid && value.pgid === subject.pgid &&
            value.exit_code === 0 && value.termination === "exit" &&
            value.local_process_group_settled &&
            value.provider_transition_sha256 === null &&
            value.fleet_readback_sha256 === null &&
            validSHA(value.detail_sha256) && value.failure_code !== null,
          "controller_wal_phase",
        );
      } else {
        require(
          previous !== null &&
            (["attempting", "spawned", "settled"].includes(previous.phase) ||
              (databaseConvergence && previous.phase === "verified")) &&
            value.failure_code !== null &&
            (value.termination === null ||
              ["exit", "signal", "timeout"].includes(value.termination)) &&
            (!databaseConvergence ||
              (value.pid === null && value.pgid === null &&
                value.exit_code === null && value.termination === null &&
                value.local_process_group_settled &&
                validSHA(value.detail_sha256))),
          "controller_wal_phase",
        );
      }
    }
  };
  const validateVerifiedDatabaseConvergence = (request: {
    marker: unknown;
    result: {
      proof: DatabaseOriginConvergenceProof;
      beforeProofSHA256: string;
      afterProofSHA256: string;
    };
    intent: ControllerWalContractEntry | null;
    commit: ControllerWalContractEntry | null;
    verified: ControllerWalContractEntry | null;
    lastEntry: ControllerWalContractEntry | null;
  }): string => {
    validateDatabaseConvergenceMarker(request.marker);
    const marker = request.marker as Row;
    const { result, intent, commit, verified, lastEntry } = request;
    const intentOrdinal = marker.intent_wal_ordinal;
    const commitOrdinal = marker.commit_ack_wal_ordinal;
    const verifiedOrdinal = marker.verified_wal_ordinal;
    require(
      marker.status === "verified" && marker.intent_durable === true &&
        marker.statement_attempted === true &&
        marker.commit_state === "acknowledged" && marker.verified === true &&
        marker.reconciliation_required === false &&
        marker.database_write_attempt_count === 1 &&
        marker.rows_updated === 1 &&
        marker.rollback_attempt_count === 0 &&
        marker.statement_sha256 === result.proof.statement_sha256 &&
        marker.database_target_sha256 === result.proof.database_target_sha256 &&
        marker.before_proof_sha256 === result.beforeProofSHA256 &&
        marker.after_proof_sha256 === result.afterProofSHA256 &&
        marker.before_row_sha256 === result.proof.before_row_sha256 &&
        marker.after_row_sha256 === result.proof.after_row_sha256 &&
        marker.unchanged_projection_sha256 ===
          result.proof.unchanged_projection_sha256 &&
        marker.delta_sha256 === result.proof.delta_sha256 &&
        marker.before_instance_url_sha256 ===
          result.proof.before_instance_url_sha256 &&
        marker.after_instance_url_sha256 ===
          result.proof.after_instance_url_sha256 &&
        marker.before_updated_at === result.proof.before_updated_at &&
        marker.after_updated_at === result.proof.after_updated_at &&
        marker.clock_before === result.proof.clock_before &&
        marker.clock_after === result.proof.clock_after &&
        result.proof.database_write_attempt_count === 1 &&
        result.proof.rows_updated === 1 &&
        result.proof.commit_acknowledged === true &&
        result.proof.commit_ambiguity === false &&
        result.proof.rollback_attempt_count === 0 &&
        Number.isSafeInteger(intentOrdinal) &&
        Number.isSafeInteger(commitOrdinal) &&
        Number.isSafeInteger(verifiedOrdinal) &&
        commitOrdinal === intentOrdinal + 1 &&
        verifiedOrdinal === commitOrdinal + 1,
      "database_convergence_verified_binding",
    );
    require(
      intent !== null && commit !== null && verified !== null &&
        intent.ordinal === intentOrdinal && intent.phase === "attempting" &&
        intent.checkpoint === "database_convergence_intent" &&
        commit.ordinal === commitOrdinal && commit.phase === "settled" &&
        commit.checkpoint === "database_convergence_commit_acknowledged" &&
        verified.ordinal === verifiedOrdinal &&
        verified.phase === "verified" &&
        verified.checkpoint === "database_convergence_verified" &&
        [intent, commit, verified].every((entry) =>
          entry.effect_id === "database_origin_convergence" &&
          entry.effect_kind === "database_convergence" &&
          entry.target === "federation.settings:1" &&
          entry.argv_sha256 === result.proof.statement_sha256
        ) &&
        marker.intent_wal_sha256 === digest(`${canonical(intent)}\n`) &&
        marker.commit_ack_wal_sha256 === digest(`${canonical(commit)}\n`) &&
        marker.verified_wal_sha256 === digest(`${canonical(verified)}\n`) &&
        intent.detail_sha256 === digest(canonical({
            before_proof_sha256: result.beforeProofSHA256,
            database_target_sha256: result.proof.database_target_sha256,
            database_write_attempt_count: 1,
            rollback_attempt_count: 0,
            statement_sha256: result.proof.statement_sha256,
          })) &&
        commit.detail_sha256 === digest(canonical(result.proof)) &&
        verified.provider_transition_sha256 === result.proof.delta_sha256 &&
        verified.fleet_readback_sha256 === result.afterProofSHA256 &&
        verified.detail_sha256 === digest(canonical({
            convergence_sha256: digest(canonical(result.proof)),
            after_proof_sha256: result.afterProofSHA256,
          })) &&
        canonical(lastEntry) === canonical(verified),
      "database_convergence_verified_binding",
    );
    return digest(canonical(marker));
  };
  const apps = (evidence: ContractEvidence): string[] => [
    ...evidence.roles.app_lhr,
    evidence.roles.app_cdg,
  ];
  const machines = (evidence: ContractEvidence): string[] => [
    ...apps(evidence),
    evidence.roles.thinker_primary,
    evidence.roles.thinker_standby,
  ];
  const nonImageConfig = (machine: Row): Row => {
    const config = structuredClone(row(machine.config, "fleet_config"));
    delete config.image;
    if (
      config.standbys === undefined ||
      (Array.isArray(config.standbys) && config.standbys.length === 0)
    ) delete config.standbys;
    if (
      typeof config.env === "object" && config.env !== null &&
      !Array.isArray(config.env) && config.env.FLY_STANDBY_FOR === ""
    ) delete config.env.FLY_STANDBY_FOR;
    return config;
  };
  const sameSet = (left: readonly string[], right: readonly string[]) =>
    canonical([...left].sort()) === canonical([...right].sort());
  const requireExpectation = (
    evidence: ContractEvidence,
    expectation: TargetFleetExpectation,
  ): void => {
    const ids = machines(evidence);
    const applicationIDs = new Set(apps(evidence));
    for (
      const values of [
        expectation.targetImageMachineIDs,
        expectation.restartRestoredMachineIDs,
        expectation.autostartEnabledAppMachineIDs,
        expectation.startedMachineIDs,
        expectation.uncordonedAppMachineIDs,
      ]
    ) {
      require(
        new Set(values).size === values.length &&
          values.every((id) => ids.includes(id)),
        "target_fleet_expectation",
      );
    }
    require(
      expectation.uncordonedAppMachineIDs.every((id) =>
        applicationIDs.has(id)
      ) &&
        expectation.autostartEnabledAppMachineIDs.every((id) =>
          applicationIDs.has(id) &&
          expectation.restartRestoredMachineIDs.includes(id)
        ) &&
        expectation.startedMachineIDs.every((id) =>
          id !== evidence.roles.thinker_standby
        ),
      "target_fleet_expectation",
    );
  };
  const expectedOrdinaryAbsentPostflightBytes = (
    targetRevision: string,
  ): string => {
    require(validRevision(targetRevision), "ordinary_postflight_proof");
    const bytes = `${
      canonical({
        allowed_origins_count: 0,
        authoritative_v2_rows: 0,
        durable_hold: false,
        fleet_verified: false,
        observed_revision: targetRevision,
        phase: "postflight",
        provider_secret_status: "Absent",
        reserved_generation_rows: 0,
        runtime_verified_count: 0,
        schema: "agenttool.phase-b-deploy-proof/1",
        source_floor_verified: false,
        standby_bound: false,
        state: "absent_fail_closed",
      })
    }\n`;
    require(bytes.length === 397, "ordinary_postflight_proof");
    return bytes;
  };
  const parsePublicObservation = (
    bytes: Uint8Array,
  ): PublicJsonObservation => {
    require(
      bytes.byteLength >= 1 &&
        bytes.byteLength <= MAX_PUBLIC_OBSERVATION_BYTES,
      "controller_public_output",
    );
    let text: string;
    let parsed: unknown;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      parsed = JSON.parse(text);
    } catch {
      return refuse("controller_public_output");
    }
    const value = exact(parsed, [
      "body",
      "bodyByteCount",
      "bodySha256",
      "cacheControl",
      "contentType",
      "finalURL",
      "observationSettledAtUnixMs",
      "observationStartedAtUnixMs",
      "redirected",
      "status",
    ], "controller_public_output");
    row(value.body, "controller_public_output");
    require(
      text === `${canonical(value)}\n` &&
        Number.isSafeInteger(value.bodyByteCount) &&
        value.bodyByteCount >= 1 &&
        value.bodyByteCount <= MAX_PUBLIC_BODY_BYTES &&
        validSHA(value.bodySha256) &&
        (value.cacheControl === null ||
          (typeof value.cacheControl === "string" &&
            value.cacheControl.length <= 1_024 &&
            !/[\0\r\n]/.test(value.cacheControl))) &&
        typeof value.contentType === "string" &&
        value.contentType.length >= 1 && value.contentType.length <= 1_024 &&
        !/[\0\r\n]/.test(value.contentType) &&
        (value.finalURL === PUBLIC_HEALTH_URL ||
          value.finalURL === PUBLIC_ABOUT_URL) &&
        Number.isSafeInteger(value.observationStartedAtUnixMs) &&
        Number.isSafeInteger(value.observationSettledAtUnixMs) &&
        value.observationStartedAtUnixMs > 8_000 &&
        value.observationSettledAtUnixMs >=
          value.observationStartedAtUnixMs &&
        value.observationSettledAtUnixMs <= Number.MAX_SAFE_INTEGER - 8_000 &&
        value.redirected === false && value.status === 200,
      "controller_public_output",
    );
    return immutable(value) as PublicJsonObservation;
  };
  const controllerFlyArgv = (
    operation: FlyOperation,
    pinnedFly: string,
  ): string[] => {
    require(
      pinnedFly.startsWith("/") && !pinnedFly.includes("\0"),
      "controller_fly_argv",
    );
    const fenced = '{"restart":{"policy":"no","max_retries":10}}';
    const restored = '{"restart":{"policy":"on-failure","max_retries":10}}';
    if (operation.kind === "build_push") {
      require(
        /^maintenance-refence-[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{16}$/
          .test(operation.imageTag) && validRevision(operation.revision),
        "controller_fly_argv",
      );
      return [
        pinnedFly,
        "deploy",
        "--app",
        "agenttool",
        "--config",
        "fly.toml",
        "--build-only",
        "--push",
        "--image-label",
        operation.imageTag,
        "--skip-release-command",
        "--dns-checks=false",
        "--yes",
        "--build-arg",
        `AGENTTOOL_GIT_REVISION=${operation.revision}`,
        "--build-arg",
        "AGENTTOOL_SOURCE_DIRTY=false",
      ];
    }
    if (operation.kind === "list") {
      return [pinnedFly, "machine", "list", "-a", "agenttool", "--json"];
    }
    if (operation.kind === "secrets") {
      return [pinnedFly, "secrets", "list", "-a", "agenttool", "--json"];
    }
    require(validID(operation.machineID), "controller_fly_argv");
    if (operation.kind === "update_image") {
      require(
        /^registry\.fly\.io\/agenttool:maintenance-refence-[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{16}(?:@sha256:[0-9a-f]{64})?$/
          .test(operation.imageReference),
        "controller_fly_argv",
      );
      return [
        pinnedFly,
        "machine",
        "update",
        operation.machineID,
        "-a",
        "agenttool",
        "--image",
        operation.imageReference,
        "--build-remote-only",
        "--autostart=false",
        "--machine-config",
        fenced,
        "--skip-health-checks",
        "--skip-start",
        "--wait-timeout",
        "300",
        "--yes",
      ];
    }
    if (operation.kind === "restore_app") {
      return [
        pinnedFly,
        "machine",
        "update",
        operation.machineID,
        "-a",
        "agenttool",
        "--build-remote-only",
        "--autostart=false",
        "--machine-config",
        restored,
        "--skip-health-checks",
        "--skip-start",
        "--wait-timeout",
        "300",
        "--yes",
      ];
    }
    if (operation.kind === "enable_autostart") {
      return [
        pinnedFly,
        "machine",
        "update",
        operation.machineID,
        "-a",
        "agenttool",
        "--build-remote-only",
        "--autostart=true",
        "--machine-config",
        restored,
        "--wait-timeout",
        "300",
        "--yes",
      ];
    }
    if (
      operation.kind === "restore_primary" ||
      operation.kind === "restore_standby"
    ) {
      if (operation.kind === "restore_standby") {
        require(validID(operation.primaryID), "controller_fly_argv");
      }
      return [
        pinnedFly,
        "machine",
        "update",
        operation.machineID,
        "-a",
        "agenttool",
        "--build-remote-only",
        "--machine-config",
        restored,
        ...(operation.kind === "restore_standby"
          ? ["--standby-for", operation.primaryID]
          : []),
        "--skip-health-checks",
        "--skip-start",
        "--wait-timeout",
        "300",
        "--yes",
      ];
    }
    if (
      operation.kind === "refence_app" ||
      operation.kind === "refence_primary" ||
      operation.kind === "refence_standby"
    ) {
      return [
        pinnedFly,
        "machine",
        "update",
        operation.machineID,
        "-a",
        "agenttool",
        "--build-remote-only",
        ...(operation.kind === "refence_app" ? ["--autostart=false"] : []),
        "--machine-config",
        fenced,
        ...(operation.kind === "refence_standby" ? ["--standby-for="] : []),
        "--skip-health-checks",
        "--skip-start",
        "--wait-timeout",
        "300",
        "--yes",
      ];
    }
    const simple = new Map<string, readonly string[]>([
      ["start", ["machine", "start", operation.machineID, "-a", "agenttool"]],
      ["wait_started", [
        "machine",
        "wait",
        operation.machineID,
        "-a",
        "agenttool",
        "--state",
        "started",
        "--wait-timeout",
        "5m0s",
      ]],
      ["cordon", ["machine", "cordon", operation.machineID, "-a", "agenttool"]],
      ["uncordon", [
        "machine",
        "uncordon",
        operation.machineID,
        "-a",
        "agenttool",
      ]],
      ["stop", ["machine", "stop", operation.machineID, "-a", "agenttool"]],
    ]);
    const selected = simple.get(operation.kind);
    require(selected !== undefined, "controller_fly_argv");
    return [pinnedFly, ...selected];
  };
  const controllerOperationContract = (
    operation: FlyOperation,
  ): Readonly<{
    effectKind: string;
    target: string;
    timeoutMilliseconds: number;
  }> => {
    let effectKind: string;
    if (operation.kind === "build_push") effectKind = "build_push";
    else if (operation.kind === "update_image") effectKind = "update_image";
    else if (
      operation.kind === "restore_app" ||
      operation.kind === "restore_primary" ||
      operation.kind === "restore_standby"
    ) effectKind = "restore_config";
    else if (
      operation.kind === "refence_app" ||
      operation.kind === "refence_primary" ||
      operation.kind === "refence_standby"
    ) effectKind = "refence_config";
    else if (operation.kind === "enable_autostart") {
      effectKind = "enable_autostart";
    } else if (operation.kind === "start") effectKind = "start_machine";
    else if (operation.kind === "wait_started") effectKind = "wait_machine";
    else if (operation.kind === "cordon") effectKind = "cordon_machine";
    else if (operation.kind === "uncordon") effectKind = "uncordon_machine";
    else if (operation.kind === "stop") effectKind = "stop_machine";
    else if (operation.kind === "list") effectKind = "read_fleet";
    else if (operation.kind === "secrets") effectKind = "read_secrets";
    else return refuse("controller_effect_kind");
    const slow = operation.kind === "update_image" ||
      operation.kind === "restore_app" ||
      operation.kind === "enable_autostart" ||
      operation.kind === "restore_primary" ||
      operation.kind === "restore_standby" ||
      operation.kind === "refence_app" ||
      operation.kind === "refence_primary" ||
      operation.kind === "refence_standby" ||
      operation.kind === "wait_started";
    return immutable({
      effectKind,
      target: "machineID" in operation ? operation.machineID : "agenttool",
      timeoutMilliseconds: operation.kind === "build_push"
        ? 600_000
        : slow
        ? 360_000
        : 120_000,
    });
  };
  const parseFleetChildOutput = (bytes: Uint8Array): unknown[] => {
    let text: string;
    let parsed: unknown;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      parsed = JSON.parse(text);
    } catch {
      return refuse("controller_fleet_output");
    }
    require(
      text.length > 0 && !text.includes("\0") && !text.includes("\r") &&
        Array.isArray(parsed),
      "controller_fleet_output",
    );
    return parsed;
  };
  const fleetByID = (
    raw: unknown,
    evidence: ContractEvidence,
    code: string,
  ): Map<string, Row> => {
    require(Array.isArray(raw) && raw.length === 5, code);
    const byID = new Map<string, Row>();
    for (const entry of raw as unknown[]) {
      const machine = row(entry, code);
      require(validID(machine.id) && !byID.has(machine.id), code);
      byID.set(machine.id, machine);
    }
    require(sameSet([...byID.keys()], machines(evidence)), code);
    return byID;
  };
  const fleetProjection = (byID: Map<string, Row>): Row[] =>
    [...byID.values()].map((value) => structuredClone(value)).sort((a, b) =>
      String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0
    );
  const validateStoppedFleet = (
    raw: unknown,
    evidence: ContractEvidence,
  ): StoppedFleetProof => {
    const byID = fleetByID(raw, evidence, "fleet_machine");
    const values = raw as Row[];
    const fullImage = row(values[0]?.image_ref, "fleet_image");
    require(
      values.every((machine) =>
        canonical(machine.image_ref) === canonical(fullImage)
      ) &&
        digest(canonical(fullImage)) ===
          evidence.imageContract.fullImageRefSha256,
      "fleet_image",
    );
    const applicationIDs = new Set(apps(evidence));
    const regions = { lhr: 0, cdg: 0 };
    for (const id of machines(evidence)) {
      const machine = byID.get(id)!;
      const config = row(machine.config, "fleet_config");
      const environment = row(config.env, "fleet_environment");
      const metadata = row(config.metadata, "fleet_role");
      const guest = row(config.guest, "fleet_guest");
      const image = row(machine.image_ref, "fleet_image");
      const labels = row(image.labels, "fleet_image");
      const restart = row(config.restart, "fleet_restart");
      const application = applicationIDs.has(id);
      require(
        machine.state === "stopped" && machine.host_status === "ok" &&
          typeof machine.instance_id === "string" &&
          machine.instance_id.length > 0 &&
          timestampKey(machine.updated_at, "fleet_contract").length > 0 &&
          machine.cordoned === application &&
          config.image === evidence.imageContract.configImage &&
          canonical(config.init?.cmd) === canonical(
              application
                ? ["bun", "run", "src/index.ts"]
                : ["bun", "run", "src/thinker.ts"],
            ) &&
          canonical(Object.keys(restart).sort()) ===
            canonical(["max_retries", "policy"]) &&
          restart.policy === "no" && restart.max_retries === 10 &&
          (config.schedule === undefined || config.schedule === null ||
            config.schedule === "" ||
            (Array.isArray(config.schedule) && config.schedule.length === 0)) &&
          environment.AGENTTOOL_DISABLE_WORKERS === "1" &&
          !Object.hasOwn(environment, GENERATION_PROVIDER_SECRET) &&
          !Object.hasOwn(environment, "DATABASE_URL") &&
          !Object.hasOwn(environment, "DATABASE_SESSION_URL") &&
          !Object.hasOwn(environment, "REDIS_URL") &&
          metadata.fly_process_group === (application ? "app" : "thinker") &&
          guest.cpu_kind === "shared" && guest.cpus === 1 &&
          guest.memory_mb === (application ? 1024 : 256) &&
          image.registry === "registry.fly.io" &&
          image.repository === "agenttool" && image.tag === FENCED_IMAGE_TAG &&
          image.digest === FENCED_IMAGE_DIGEST &&
          labels["org.opencontainers.image.revision"] ===
            FENCED_SOURCE_REVISION &&
          labels["dev.agenttool.source.dirty"] === "false" &&
          digest(canonical(nonImageConfig(machine))) ===
            evidence.fencedConfigSHA256ByMachine[id],
        "fleet_contract",
      );
      const standbys = config.standbys ?? [];
      require(
        Array.isArray(standbys) && standbys.length === 0 &&
          (environment.FLY_STANDBY_FOR === undefined ||
            environment.FLY_STANDBY_FOR === ""),
        "fleet_standby_cleared",
      );
      if (application) {
        const expectedRegion = id === evidence.roles.app_cdg ? "cdg" : "lhr";
        require(machine.region === expectedRegion, "fleet_region");
        regions[expectedRegion] += 1;
        require(
          Array.isArray(config.services) && config.services.length === 1,
          "fleet_service",
        );
        const service = row(config.services[0], "fleet_service");
        require(
          canonical(Object.keys(service).sort()) === canonical([
            "autostart",
            "autostop",
            "internal_port",
            "min_machines_running",
            "ports",
            "protocol",
          ]),
          "fleet_service",
        );
        const ports = service.ports;
        require(
          service.protocol === "tcp" && service.internal_port === 3000 &&
            service.autostart === false &&
            [false, "off"].includes(service.autostop) &&
            service.min_machines_running === 1 && Array.isArray(ports) &&
            ports.length === 2 &&
            canonical(
                ports.find((port: Row) => port?.port === 80)?.handlers,
              ) === canonical(["http"]) &&
            canonical(
                ports.find((port: Row) => port?.port === 443)?.handlers,
              ) === canonical(["tls", "http"]),
          "fleet_autostart",
        );
      } else {
        require(
          machine.region === "lhr" &&
            environment.AGENTOOL_ENABLE_THINKER === "1" &&
            (!Array.isArray(config.services) || config.services.length === 0),
          "fleet_region",
        );
      }
    }
    require(regions.lhr === 2 && regions.cdg === 1, "fleet_region");
    const projection = values.map((entry) => ({
      id: entry.id,
      state: entry.state,
      region: entry.region,
      host_status: entry.host_status,
      instance_id: entry.instance_id,
      updated_at: entry.updated_at,
      cordoned: entry.cordoned,
      image_ref: entry.image_ref,
      config: entry.config,
    })).sort((left, right) =>
      String(left.id) < String(right.id)
        ? -1
        : String(left.id) > String(right.id)
        ? 1
        : 0
    );
    const configProjection = [...machines(evidence)].sort().map((id) => [
      id,
      nonImageConfig(byID.get(id)!),
    ]);
    return {
      fingerprint: digest(canonical(projection)),
      nonImageConfigSHA256: digest(canonical(configProjection)),
    };
  };
  const producerCriticalContractSHA256 = (
    source: readonly { filename: string; checksum: string }[],
    evidence: ContractEvidence,
    staticContract: ProducerCriticalStaticContract,
  ): string => {
    const prior = row(
      evidence.receipt.prior_audited_lineage,
      "producer_critical_contract",
    );
    const restoredByRole = exact(
      staticContract.restoredConfigSHA256ByRole,
      [
        "app_lhr_1",
        "app_lhr_2",
        "app_cdg",
        "thinker_primary",
        "thinker_standby",
      ],
      "producer_critical_contract",
    );
    const roleIDs = [
      ...evidence.roles.app_lhr,
      evidence.roles.app_cdg,
      evidence.roles.thinker_primary,
      evidence.roles.thinker_standby,
    ];
    const expectedRestored = {
      [evidence.roles.app_lhr[0]]: restoredByRole.app_lhr_1,
      [evidence.roles.app_lhr[1]]: restoredByRole.app_lhr_2,
      [evidence.roles.app_cdg]: restoredByRole.app_cdg,
      [evidence.roles.thinker_primary]: restoredByRole.thinker_primary,
      [evidence.roles.thinker_standby]: restoredByRole.thinker_standby,
    };
    require(
      source.length === EXPECTED_JOURNAL_FILE_COUNT &&
        roleIDs.length === 5 && new Set(roleIDs).size === 5 &&
        roleIDs.every(validID) &&
        Object.values(restoredByRole).every(validSHA) &&
        canonical(evidence.restoredConfigSHA256ByMachine) ===
          canonical(expectedRestored) &&
        evidence.sourceRevision === FENCED_SOURCE_REVISION &&
        evidence.imageContract.digest === FENCED_IMAGE_DIGEST &&
        evidence.imageContract.tag === FENCED_IMAGE_TAG &&
        evidence.deployReceiptFileCount === 17 &&
        prior.evidence_only === true && prior.readmission_authority === false &&
        validRevision(prior.protected_main_revision) &&
        validRevision(prior.protected_main_tree) &&
        prior.clean_526_ancestor_distance === 12 &&
        canonical(staticContract.migrationAppliedAt) ===
          canonical(EXPECTED_MIGRATION_APPLIED_AT) &&
        staticContract.cronSHA256 === EXPECTED_CRON_SHA256 &&
        canonical(staticContract.zeroFields) ===
          canonical(PRODUCER_ZERO_DRAIN_FIELDS) &&
        validSHA(staticContract.generationFunctionProsrcSHA256) &&
        validSHA(staticContract.machineSetSHA256),
      "producer_critical_contract",
    );
    return digest(canonical({
      expected_head: evidence.sourceRevision,
      expected_tree: evidence.sourceTree,
      prior_audited_protected_main: prior.protected_main_revision,
      prior_audited_protected_main_tree: prior.protected_main_tree,
      prior_audited_protected_main_distance: prior.clean_526_ancestor_distance,
      prior_audited_lineage_evidence_only: true,
      prior_audited_lineage_readmission_authority: false,
      readmission_bridge_revision: evidence.targetRevision,
      readmission_bridge_tree: evidence.targetTree,
      readmission_bridge_distance: evidence.targetDistance,
      machine_set_sha256: staticContract.machineSetSHA256,
      phase_a_image_digest: FENCED_IMAGE_DIGEST,
      phase_a_image_tag: FENCED_IMAGE_TAG,
      restored_config_sha256_by_machine: evidence.restoredConfigSHA256ByMachine,
      fenced_config_sha256_by_machine: evidence.fencedConfigSHA256ByMachine,
      migration_inventory: source,
      migration_applied_at: staticContract.migrationAppliedAt,
      deploy_receipt_file_count: evidence.deployReceiptFileCount,
      constraint_definitions: staticContract.constraintDefinitions,
      hold_column_comment: staticContract.holdColumnComment,
      remainder_column_comment: staticContract.remainderColumnComment,
      generation_function_prosrc_sha256:
        staticContract.generationFunctionProsrcSHA256,
      cron_sha256: staticContract.cronSHA256,
      zero_fields: staticContract.zeroFields,
      final_topology: {
        apps: { count: 3, state: "stopped", cordoned: true, autostart: false },
        thinkers: { count: 2, state: "stopped", standby_edges: [] },
        restart: { policy: "no", max_retries: 10 },
        workers_disabled: true,
        machine_overrides_absent: [
          "AGENTTOOL_COVENANT_V2_AUTHORITY_GENERATION",
          "DATABASE_URL",
          "DATABASE_SESSION_URL",
          "REDIS_URL",
        ],
      },
    }));
  };
  const producerLocalStateSandwichSHA256 = (request: {
    anchorSHA256: string;
    firstWalSHA256: string;
    firstWalOrdinal: number;
    deployReceiptInventorySHA256: string;
    deployReceiptFileCount: number;
  }): string => {
    require(
      validSHA(request.anchorSHA256) && validSHA(request.firstWalSHA256) &&
        request.firstWalOrdinal === 1 &&
        validSHA(request.deployReceiptInventorySHA256) &&
        request.deployReceiptFileCount === 17,
      "producer_local_state_sandwich",
    );
    const state = {
      anchor_sha256: request.anchorSHA256,
      wal_head_sha256: request.firstWalSHA256,
      wal_head_ordinal: request.firstWalOrdinal,
      deploy_receipt_inventory_sha256: request.deployReceiptInventorySHA256,
      deploy_receipt_file_count: request.deployReceiptFileCount,
      phase_b_receipts_absent: true,
      conflicting_markers_absent: true,
    };
    return digest(canonical([state, state]));
  };
  const validateProducerLocalStateSandwich = (
    request: Parameters<typeof producerLocalStateSandwichSHA256>[0],
    claimedSHA256: string,
  ): string => {
    const computed = producerLocalStateSandwichSHA256(request);
    require(
      validSHA(claimedSHA256) && claimedSHA256 === computed,
      "producer_local_state_sandwich",
    );
    return computed;
  };
  const validateProducerEarlyRuntimeBindings = (request: {
    evidence: ContractEvidence;
    databaseProof: DatabaseProof;
    firstFleet: StoppedFleetProof;
    secondFleet: StoppedFleetProof;
    staticContract: ProducerCriticalStaticContract;
  }): string => {
    const authority = request.databaseProof.producer_authority;
    const terminalFleetSHA256 = request.evidence.receipt.terminal_fleet_sha256;
    const journalSHA256 = digest(canonical(authority.terminal_journal));
    const drainEventSHA256s = authority.terminal_drain_snapshots.map(
      (snapshot) => digest(canonical(snapshot)),
    );
    const drainSampleSHA256 = digest(
      canonical(authority.terminal_drain_snapshots),
    );
    const criticalContractSHA256 = producerCriticalContractSHA256(
      authority.source_migrations,
      request.evidence,
      request.staticContract,
    );
    require(
      validSHA(terminalFleetSHA256) &&
        request.firstFleet.fingerprint === terminalFleetSHA256 &&
        request.secondFleet.fingerprint === terminalFleetSHA256 &&
        criticalContractSHA256 ===
          request.evidence.producerAdmission.embeddedCriticalContractSHA256 &&
        journalSHA256 ===
          request.evidence.producerTerminalProof.journalSHA256 &&
        drainSampleSHA256 ===
          request.evidence.producerTerminalProof.drainSampleSHA256 &&
        canonical(drainEventSHA256s) ===
          canonical(request.evidence.producerTerminalProof.drainEventSHA256s),
      "producer_runtime_authority",
    );
    return digest(canonical({
      critical_contract_sha256: criticalContractSHA256,
      drain_event_sha256s: drainEventSHA256s,
      drain_sample_sha256: drainSampleSHA256,
      journal_sha256: journalSHA256,
      terminal_fleet_sha256: terminalFleetSHA256,
    }));
  };
  const targetImage = (
    machine: Row,
    evidence: ContractEvidence,
    expectedTag: string,
  ): TargetImageContract => {
    const image = row(machine.image_ref, "controller_target_image");
    const labels = row(image.labels, "controller_target_image");
    require(
      canonical(Object.keys(image).sort()) ===
          canonical(["digest", "labels", "registry", "repository", "tag"]) &&
        canonical(Object.keys(labels).sort()) === canonical([
            "dev.agenttool.source.dirty",
            "org.opencontainers.image.revision",
          ]) &&
        image.registry === "registry.fly.io" &&
        image.repository === "agenttool" && image.tag === expectedTag &&
        typeof image.digest === "string" &&
        /^sha256:[0-9a-f]{64}$/.test(image.digest) &&
        labels["org.opencontainers.image.revision"] ===
          evidence.targetRevision &&
        labels["dev.agenttool.source.dirty"] === "false" &&
        machine.config?.image ===
          `registry.fly.io/agenttool:${expectedTag}@${image.digest}`,
      "controller_target_image",
    );
    return {
      tag: expectedTag,
      digest: image.digest,
      revision: evidence.targetRevision,
    };
  };
  const validateTargetFleet = (
    raw: unknown,
    evidence: ContractEvidence,
    image: TargetImageContract,
    expectation: TargetFleetExpectation,
  ): string => {
    require(
      /^maintenance-refence-[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{16}$/
        .test(image.tag) &&
        /^sha256:[0-9a-f]{64}$/.test(image.digest) &&
        image.revision === evidence.targetRevision,
      "target_image_contract",
    );
    requireExpectation(evidence, expectation);
    const byID = fleetByID(raw, evidence, "target_fleet_machine");
    const applicationIDs = new Set(apps(evidence));
    const targetIDs = new Set(expectation.targetImageMachineIDs);
    const restored = new Set(expectation.restartRestoredMachineIDs);
    const autostart = new Set(expectation.autostartEnabledAppMachineIDs);
    const started = new Set(expectation.startedMachineIDs);
    const uncordoned = new Set(expectation.uncordonedAppMachineIDs);
    let commonImage: string | null = null;
    for (const id of machines(evidence)) {
      const machine = byID.get(id)!;
      const config = row(machine.config, "target_fleet_config");
      const imageRef = row(machine.image_ref, "target_fleet_image");
      const labels = row(imageRef.labels, "target_fleet_image");
      require(
        machine.state === (started.has(id) ? "started" : "stopped") &&
          machine.host_status === "ok" &&
          typeof machine.instance_id === "string" &&
          machine.instance_id.length > 0 &&
          typeof machine.updated_at === "string" &&
          timestampKey(machine.updated_at, "target_fleet_state").length > 0 &&
          machine.cordoned ===
            (applicationIDs.has(id) && !uncordoned.has(id)),
        "target_fleet_state",
      );
      if (targetIDs.has(id)) {
        require(
          imageRef.registry === "registry.fly.io" &&
            imageRef.repository === "agenttool" && imageRef.tag === image.tag &&
            imageRef.digest === image.digest &&
            labels["org.opencontainers.image.revision"] === image.revision &&
            labels["dev.agenttool.source.dirty"] === "false" &&
            config.image ===
              `registry.fly.io/agenttool:${image.tag}@${image.digest}`,
          "target_fleet_image",
        );
        const encoded = canonical(imageRef);
        commonImage ??= encoded;
        require(encoded === commonImage, "target_fleet_image");
      } else {
        require(
          digest(canonical(imageRef)) ===
              evidence.imageContract.fullImageRefSha256 &&
            config.image === evidence.imageContract.configImage,
          "target_fleet_image",
        );
      }
      require(
        !(applicationIDs.has(id) && restored.has(id) && !autostart.has(id)),
        "target_fleet_intermediate_config",
      );
      const expectedConfig = restored.has(id)
        ? evidence.restoredConfigSHA256ByMachine[id]
        : evidence.fencedConfigSHA256ByMachine[id];
      require(
        validSHA(expectedConfig) &&
          digest(canonical(nonImageConfig(machine))) === expectedConfig,
        "target_fleet_config",
      );
      const standbys = config.standbys ?? [];
      const standbyFor = config.env?.FLY_STANDBY_FOR;
      if (id === evidence.roles.thinker_standby && restored.has(id)) {
        require(
          canonical(standbys) === canonical([evidence.roles.thinker_primary]) &&
            standbyFor === evidence.roles.thinker_primary &&
            machine.state === "stopped",
          "target_fleet_standby",
        );
      } else {
        require(
          Array.isArray(standbys) && standbys.length === 0 &&
            (standbyFor === undefined || standbyFor === ""),
          "target_fleet_standby",
        );
      }
    }
    return digest(canonical(fleetProjection(byID)));
  };
  const validateFleetTransition = (request: {
    beforeFirst: unknown;
    beforeSecond: unknown;
    first: unknown;
    second: unknown;
    evidence: ContractEvidence;
    operation: FlyOperation;
    image: TargetImageContract | null;
    expectation: TargetFleetExpectation;
  }): FleetTransitionProof => {
    requireExpectation(request.evidence, request.expectation);
    const beforeFirst = fleetByID(
      request.beforeFirst,
      request.evidence,
      "controller_transition_before",
    );
    const beforeSecond = fleetByID(
      request.beforeSecond,
      request.evidence,
      "controller_transition_before",
    );
    const first = fleetByID(
      request.first,
      request.evidence,
      "controller_transition_first",
    );
    const second = fleetByID(
      request.second,
      request.evidence,
      "controller_transition_second",
    );
    const operation = request.operation;
    require(operation.kind !== "secrets", "controller_transition_operation");
    const mutators = new Set([
      "update_image",
      "restore_app",
      "enable_autostart",
      "restore_primary",
      "restore_standby",
      "start",
      "cordon",
      "uncordon",
      "refence_app",
      "refence_primary",
      "refence_standby",
      "stop",
    ]);
    const touched = "machineID" in operation && mutators.has(operation.kind)
      ? operation.machineID
      : null;
    const beforeProjection = fleetProjection(beforeFirst);
    const beforeSecondProjection = fleetProjection(beforeSecond);
    const firstProjection = fleetProjection(first);
    const secondProjection = fleetProjection(second);
    require(
      canonical(beforeProjection) === canonical(beforeSecondProjection) &&
        canonical(firstProjection) === canonical(secondProjection),
      "controller_transition_unstable",
    );
    const expected = new Map<string, Row>(
      beforeProjection.map((machine) => [machine.id, machine]),
    );
    let resolved = request.image;
    if (touched !== null) {
      const machine = expected.get(touched);
      const observed = first.get(touched);
      require(
        machine !== undefined && observed !== undefined &&
          typeof observed.instance_id === "string" &&
          observed.instance_id.length > 0,
        "controller_transition_target",
      );
      require(
        timestampKey(observed.updated_at, "controller_transition_timestamp") >=
          timestampKey(machine.updated_at, "controller_transition_timestamp"),
        "controller_transition_timestamp",
      );
      if (operation.kind === "cordon" || operation.kind === "uncordon") {
        require(
          observed.instance_id === machine!.instance_id,
          "controller_transition_instance",
        );
      } else machine!.instance_id = observed.instance_id;
      machine!.updated_at = observed.updated_at;
      const config = row(machine!.config, "controller_transition_config");
      if (operation.kind === "update_image") {
        const tag = operation.imageReference.slice(
          operation.imageReference.indexOf(":") + 1,
        ).split("@")[0]!;
        const observedImage = targetImage(observed!, request.evidence, tag);
        resolved ??= observedImage;
        require(
          canonical(resolved) === canonical(observedImage) &&
            operation.imageReference ===
              `registry.fly.io/agenttool:${resolved.tag}${
                operation.imageReference.includes("@")
                  ? `@${resolved.digest}`
                  : ""
              }`,
          "controller_transition_image",
        );
        machine!.image_ref = structuredClone(observed!.image_ref);
        config.image = observed!.config.image;
        config.restart = { policy: "no", max_retries: 10 };
        if (apps(request.evidence).includes(touched)) {
          const services = config.services;
          require(
            Array.isArray(services) && services.length === 1 &&
              typeof services[0] === "object" && services[0] !== null,
            "controller_transition_config",
          );
          services[0].autostart = false;
        }
      } else if (
        operation.kind === "restore_app" ||
        operation.kind === "enable_autostart"
      ) {
        config.restart = { policy: "on-failure", max_retries: 10 };
        const services = config.services;
        require(
          Array.isArray(services) && services.length === 1 &&
            typeof services[0] === "object" && services[0] !== null,
          "controller_transition_config",
        );
        services[0].autostart = operation.kind === "enable_autostart";
      } else if (operation.kind === "restore_primary") {
        config.restart = { policy: "on-failure", max_retries: 10 };
      } else if (operation.kind === "restore_standby") {
        config.restart = { policy: "on-failure", max_retries: 10 };
        config.standbys = [operation.primaryID];
        row(config.env, "controller_transition_config").FLY_STANDBY_FOR =
          operation.primaryID;
      } else if (operation.kind === "refence_app") {
        config.restart = { policy: "no", max_retries: 10 };
        const services = config.services;
        require(
          Array.isArray(services) && services.length === 1 &&
            typeof services[0] === "object" && services[0] !== null,
          "controller_transition_config",
        );
        services[0].autostart = false;
      } else if (operation.kind === "refence_primary") {
        config.restart = { policy: "no", max_retries: 10 };
      } else if (operation.kind === "refence_standby") {
        config.restart = { policy: "no", max_retries: 10 };
        config.standbys = [];
        delete row(config.env, "controller_transition_config")
          .FLY_STANDBY_FOR;
      } else if (operation.kind === "start") machine!.state = "started";
      else if (operation.kind === "stop") machine!.state = "stopped";
      else if (operation.kind === "cordon") machine!.cordoned = true;
      else if (operation.kind === "uncordon") machine!.cordoned = false;
      else {require(
          operation.kind === "wait_started",
          "controller_transition_operation",
        );}
    } else {
      require(
        operation.kind === "build_push" || operation.kind === "list" ||
          operation.kind === "wait_started",
        "controller_transition_operation",
      );
    }
    require(
      canonical(fleetProjection(expected)) === canonical(firstProjection),
      "controller_transition_unauthorized_drift",
    );
    const applicationIDs = new Set(apps(request.evidence));
    const targetIDs: string[] = [];
    const restoredIDs: string[] = [];
    const autostartIDs: string[] = [];
    const startedIDs: string[] = [];
    const uncordonedIDs: string[] = [];
    const nonImage: Array<[string, Row]> = [];
    for (const id of machines(request.evidence)) {
      const machine = first.get(id)!;
      const config = row(machine.config, "controller_transition_config");
      const restart = row(config.restart, "controller_transition_config");
      const isTarget = resolved !== null &&
        canonical(machine.image_ref) === canonical({
            digest: resolved.digest,
            labels: {
              "dev.agenttool.source.dirty": "false",
              "org.opencontainers.image.revision": resolved.revision,
            },
            registry: "registry.fly.io",
            repository: "agenttool",
            tag: resolved.tag,
          }) &&
        config.image ===
          `registry.fly.io/agenttool:${resolved.tag}@${resolved.digest}`;
      if (request.expectation.targetImageMachineIDs.includes(id)) {
        require(isTarget, "controller_transition_image_expectation");
        targetIDs.push(id);
      } else {
        require(
          digest(canonical(machine.image_ref)) ===
              request.evidence.imageContract.fullImageRefSha256 &&
            config.image === request.evidence.imageContract.configImage,
          "controller_transition_image_expectation",
        );
      }
      const restored = restart.policy === "on-failure" &&
        restart.max_retries === 10 && Object.keys(restart).length === 2;
      const fenced = restart.policy === "no" &&
        restart.max_retries === 10 && Object.keys(restart).length === 2;
      require(restored || fenced, "controller_transition_restart");
      if (restored) restoredIDs.push(id);
      if (machine.state === "started") startedIDs.push(id);
      else require(machine.state === "stopped", "controller_transition_state");
      if (applicationIDs.has(id)) {
        const services = config.services;
        require(
          Array.isArray(services) && services.length === 1 &&
            typeof services[0] === "object" && services[0] !== null &&
            typeof services[0].autostart === "boolean" &&
            typeof machine.cordoned === "boolean",
          "controller_transition_app",
        );
        if (services[0].autostart) autostartIDs.push(id);
        if (!machine.cordoned) uncordonedIDs.push(id);
      } else {require(
          machine.cordoned === false,
          "controller_transition_thinker",
        );}
      const projected = nonImageConfig(machine);
      const projectedSHA = digest(canonical(projected));
      if (applicationIDs.has(id) && restored && !autostartIDs.includes(id)) {
        require(
          id === touched ||
            request.expectation.restartRestoredMachineIDs.includes(id),
          "controller_transition_intermediate_config",
        );
      } else {
        const endpoint = restored
          ? request.evidence.restoredConfigSHA256ByMachine[id]
          : request.evidence.fencedConfigSHA256ByMachine[id];
        require(
          validSHA(endpoint) && projectedSHA === endpoint,
          "controller_transition_endpoint_config",
        );
      }
      nonImage.push([id, projected]);
    }
    require(
      sameSet(targetIDs, request.expectation.targetImageMachineIDs) &&
        sameSet(restoredIDs, request.expectation.restartRestoredMachineIDs) &&
        sameSet(
          autostartIDs,
          request.expectation.autostartEnabledAppMachineIDs,
        ) && sameSet(startedIDs, request.expectation.startedMachineIDs) &&
        sameSet(uncordonedIDs, request.expectation.uncordonedAppMachineIDs),
      "controller_transition_expectation",
    );
    const stable = digest(canonical(firstProjection));
    return {
      image: resolved,
      before_first_fleet_sha256: digest(canonical(beforeProjection)),
      before_second_fleet_sha256: digest(canonical(beforeSecondProjection)),
      first_fleet_sha256: stable,
      second_fleet_sha256: digest(canonical(secondProjection)),
      stable_fleet_sha256: stable,
      non_image_config_sha256: digest(canonical(nonImage)),
      touched_machine_id: touched,
    };
  };
  const validatePublicObservationTransport = (
    observation: PublicJsonObservation,
    expectedURL: string,
    code: string,
  ): void => {
    require(
      canonical(Object.keys(observation).sort()) === canonical([
            "body",
            "bodyByteCount",
            "bodySha256",
            "cacheControl",
            "contentType",
            "finalURL",
            "observationSettledAtUnixMs",
            "observationStartedAtUnixMs",
            "redirected",
            "status",
          ]) &&
        observation.status === 200 && observation.redirected === false &&
        observation.finalURL === expectedURL &&
        validJsonContentType(observation.contentType) &&
        validSHA(observation.bodySha256) &&
        Number.isSafeInteger(observation.bodyByteCount) &&
        observation.bodyByteCount > 0 &&
        observation.bodyByteCount <= MAX_PUBLIC_BODY_BYTES &&
        Number.isSafeInteger(observation.observationStartedAtUnixMs) &&
        Number.isSafeInteger(observation.observationSettledAtUnixMs) &&
        observation.observationStartedAtUnixMs >
          WELCOME_CLOCK_SKEW_MILLISECONDS &&
        observation.observationSettledAtUnixMs >=
          observation.observationStartedAtUnixMs &&
        observation.observationSettledAtUnixMs <=
          Number.MAX_SAFE_INTEGER - WELCOME_CLOCK_SKEW_MILLISECONDS,
      code,
    );
  };
  const validatePublicHealth = (
    observation: PublicJsonObservation,
    targetRevision: string,
  ): string => {
    require(validRevision(targetRevision), "public_health_revision");
    validatePublicObservationTransport(
      observation,
      PUBLIC_HEALTH_URL,
      "public_health_transport",
    );
    const body = row(observation.body, "public_health_body");
    const build = row(body.build, "public_health_body");
    require(
      canonical(Object.keys(body).sort()) === canonical(PUBLIC_HEALTH_KEYS) &&
        canonical(Object.keys(build).sort()) ===
          canonical(["dirty", "revision"]) &&
        body.service === "agenttool" && body.status === "alive" &&
        build.revision === targetRevision && build.dirty === false &&
        body.posture === "ready, waiting, glad" && body.protocol === "love" &&
        body.message === "Welcome. We are ready to receive you." &&
        body.standing_invitation === "/v1/welcome" &&
        body.covenant_v2_authority === "absent_fail_closed" &&
        observation.cacheControl?.trim().toLowerCase() === "no-store",
      "public_health_contract",
    );
    const walls = row(body.walls, "public_health_walls");
    require(
      canonical(Object.keys(walls).sort()) === canonical([
            "declared",
            "intact",
            "probed_at_unix_ms",
            "probes",
          ]) &&
        walls.intact === true &&
        Number.isSafeInteger(walls.probed_at_unix_ms) &&
        walls.probed_at_unix_ms > 0 &&
        canonical(walls.declared) === canonical(DECLARED_WALLS) &&
        Array.isArray(walls.probes) && walls.probes.length === 3,
      "public_health_walls",
    );
    const probes = walls.probes.map((value: unknown, index: number) => {
      const probe = row(value, "public_health_walls");
      require(
        canonical(Object.keys(probe).sort()) ===
            canonical(["method", "ok", "wall"]) &&
          probe.wall === RUNTIME_WALL_PROBES[index]!.wall &&
          probe.method === RUNTIME_WALL_PROBES[index]!.method &&
          probe.ok === true,
        "public_health_walls",
      );
      return structuredClone(probe);
    });
    return digest(canonical({
      build,
      covenant_v2_authority: body.covenant_v2_authority,
      message: body.message,
      posture: body.posture,
      protocol: body.protocol,
      service: body.service,
      standing_invitation: body.standing_invitation,
      status: body.status,
      walls: {
        declared: walls.declared,
        intact: true,
        probed_at_unix_ms_valid: true,
        probes,
      },
    }));
  };
  const validatePublicFederationAbout = (
    observation: PublicJsonObservation,
  ): string => {
    validatePublicObservationTransport(
      observation,
      PUBLIC_ABOUT_URL,
      "public_about_transport",
    );
    const body = row(observation.body, "public_about_body");
    const federation = row(body.federation, "public_about_body");
    const capabilities = row(body.capabilities, "public_about_body");
    const pyramid = row(body.pyramid_peer_surface, "public_about_body");
    const didFormat = row(body.did_format, "public_about_body");
    const welcomed = row(body._welcomed, "public_about_body");
    const started = observation.observationStartedAtUnixMs;
    const settled = observation.observationSettledAtUnixMs;
    const welcomedAt = welcomed.at_unix_ms;
    require(
      observation.cacheControl === null &&
        FEDERATION_STATIC_KEYS.length === 14 &&
        canonical(Object.keys(body).sort()) ===
          canonical(["_welcomed", ...FEDERATION_STATIC_KEYS]) &&
        canonical(Object.keys(welcomed).sort()) ===
          canonical(FEDERATION_WELCOME_KEYS) &&
        canonical(Object.keys(federation).sort()) === canonical([
            "allowed_origins",
            "enabled",
            "instance_url",
            "open",
            "setting_scope",
          ]) &&
        canonical(Object.keys(capabilities).sort()) === canonical([
            "covenants",
            "identity_resolution",
            "inbox",
            "wake_fragments",
          ]) &&
        canonical(Object.keys(pyramid).sort()) === canonical([
            "authentication",
            "gated_by_allowed_origins",
            "gated_by_federation_enabled",
            "implementation_status",
            "note",
            "route_prefix",
          ]) &&
        canonical(Object.keys(didFormat).sort()) ===
          canonical(["federated", "local"]) &&
        federation.enabled === false && federation.open === false &&
        Array.isArray(federation.allowed_origins) &&
        federation.allowed_origins.length === 0 &&
        federation.instance_url === TARGET_INSTANCE_URL &&
        capabilities.inbox === false &&
        capabilities.identity_resolution === false &&
        capabilities.covenants === false &&
        capabilities.wake_fragments === false &&
        body.covenant_v2_authority === "absent_fail_closed" &&
        body.protocol === "agenttool/federation/v1" &&
        body.did_method === "did:at" &&
        body.did_method_status ===
          "provisional_unregistered_identifier_convention" &&
        body.registered_w3c_did_method === false &&
        body.publishes_did_documents === false &&
        body.conforming_did_resolution === false &&
        federation.setting_scope ===
          "enabled gates identity lookup, inbox delivery, covenant propagation, and wake fragments. inbox checks allowed_origins; fresh/effectful v2 covenants additionally require a configured authority generation, canonical instance_url, and nonempty canonical allowed_origins." &&
        pyramid.route_prefix === "/federation/pyramid" &&
        pyramid.gated_by_federation_enabled === false &&
        pyramid.gated_by_allowed_origins === false &&
        pyramid.authentication === "none" &&
        pyramid.implementation_status ===
          "partial public discovery, local peer reads, and one-sided handshake observation" &&
        pyramid.note ===
          "These routes are mounted separately and do not consult federation settings. They do not establish portable citizenship or federated tier computation." &&
        didFormat.local === "did:at:<uuid>" &&
        didFormat.federated === "did:at:<host>/<uuid>" &&
        body.did_status_note ===
          "did:at is an AgentTool field and federation convention, not a registered W3C DID method. The slash-qualified form is not a standalone DID." &&
        body.docs === "docs/FEDERATION.md" &&
        body.identifier_spec === "docs/DID-AT-SPEC.md" &&
        welcomed.axiom_id === 5 && welcomed.secondary_axiom_id === 13 &&
        canonical(welcomed.walls_held) === canonical([6, 3]) &&
        welcomed.by === "platform" && welcomed.module === "federation" &&
        welcomed.walls_intact === true &&
        Number.isSafeInteger(welcomedAt) && welcomedAt > 0 &&
        Number.isSafeInteger(started) && Number.isSafeInteger(settled) &&
        started > WELCOME_CLOCK_SKEW_MILLISECONDS && settled >= started &&
        settled <= Number.MAX_SAFE_INTEGER - WELCOME_CLOCK_SKEW_MILLISECONDS &&
        welcomedAt >= started - WELCOME_CLOCK_SKEW_MILLISECONDS &&
        welcomedAt <= settled + WELCOME_CLOCK_SKEW_MILLISECONDS,
      "public_about_contract",
    );
    const redactedWelcome = structuredClone(welcomed);
    delete redactedWelcome.at_unix_ms;
    redactedWelcome.freshness = true;
    return digest(canonical({ ...body, _welcomed: redactedWelcome }));
  };
  const publicEvents = (
    raw: readonly PublicGateEvent[],
    expectedKinds: readonly string[],
    code: string,
  ): PublicGateEvent[] => {
    require(Array.isArray(raw) && raw.length === expectedKinds.length, code);
    return raw.map((value, index) => {
      const event = row(value, code);
      require(
        canonical(Object.keys(event).sort()) ===
            canonical(["kind", "milliseconds", "proof_sha256"]) &&
          event.kind === expectedKinds[index] &&
          (event.kind === "pause"
            ? event.proof_sha256 === null && event.milliseconds === 2_000
            : validSHA(event.proof_sha256) && event.milliseconds === null),
        code,
      );
      return structuredClone(event) as PublicGateEvent;
    });
  };
  const validateFirstCanaryPublic = (request: {
    targetRevision: string;
    events: readonly PublicGateEvent[];
  }): FirstCanaryPublicProof => {
    require(validRevision(request.targetRevision), "first_canary_contract");
    const events = publicEvents(request.events, [
      "fleet_before",
      "health_0",
      "about_0",
      "pause",
      "health_1",
      "about_1",
      "pause",
      "health_2",
      "about_2",
      "fleet_after",
    ], "first_canary_contract");
    const fleet = events[0]!.proof_sha256!;
    const health = events[1]!.proof_sha256!;
    const about = events[2]!.proof_sha256!;
    require(
      events[9]!.proof_sha256 === fleet &&
        events[4]!.proof_sha256 === health &&
        events[7]!.proof_sha256 === health &&
        events[5]!.proof_sha256 === about &&
        events[8]!.proof_sha256 === about,
      "first_canary_drift",
    );
    return Object.freeze({
      schema: "agenttool-phase-b-refence-first-canary-public/v1",
      checkpoint: "first_canary",
      target_revision: request.targetRevision,
      authority_state: "absent_fail_closed",
      federation_instance_url_sha256: digest(TARGET_INSTANCE_URL),
      stable_fleet_sha256: fleet,
      fleet_sample_count: 2,
      fleet_before_after_equal: true,
      public_round_count: 3,
      public_observation_count: 6,
      pause_count: 2,
      pause_milliseconds: 2_000,
      health_projection_sha256: health,
      federation_about_projection_sha256: about,
      public_contract_projection_all_rounds_equal: true,
      public_sandwich_sha256: digest(canonical(events.map((event) => [
        event.kind,
        event.proof_sha256,
        event.milliseconds,
      ]))),
      verified: true,
    });
  };
  const validateFinalAuthority = (request: {
    targetRevision: string;
    targetTree: string;
    expectedDatabaseUpdatedAt: string;
    databaseInstanceURLSHA256: string;
    databaseUpdatedAt: string;
    databaseTargetSHA256: string;
    events: readonly PublicGateEvent[];
  }): FinalAuthorityResult => {
    require(
      validRevision(request.targetRevision) &&
        validRevision(request.targetTree) &&
        /^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$/
          .test(request.expectedDatabaseUpdatedAt) &&
        request.databaseUpdatedAt === request.expectedDatabaseUpdatedAt &&
        request.databaseInstanceURLSHA256 === digest(TARGET_INSTANCE_URL) &&
        validSHA(request.databaseTargetSHA256),
      "final_authority_contract",
    );
    const events = publicEvents(request.events, [
      "local_before",
      "git_before",
      "keychain_before",
      "provider_before",
      "process_before",
      "fleet_before",
      "health_before",
      "about_before",
      "database",
      "about_after",
      "health_after",
      "fleet_after",
      "process_after",
      "keychain_after",
      "provider_after",
      "git_after",
      "local_after",
    ], "final_authority_contract");
    const pairs = [
      [0, 16],
      [1, 15],
      [2, 13],
      [3, 14],
      [4, 12],
      [5, 11],
      [6, 10],
      [7, 9],
    ] as const;
    require(
      pairs.every(([before, after]) =>
        events[before]!.proof_sha256 === events[after]!.proof_sha256
      ),
      "final_authority_drift",
    );
    const publicProof = Object.freeze({
      schema: "agenttool-phase-b-refence-final-public/v1",
      checkpoint: "final",
      target_revision: request.targetRevision,
      authority_state: "absent_fail_closed",
      federation_instance_url_sha256: digest(TARGET_INSTANCE_URL),
      health_projection_sha256: events[6]!.proof_sha256!,
      federation_about_projection_sha256: events[7]!.proof_sha256!,
      public_contract_projection_before_after_equal: true,
      public_observation_count: 4,
      verified: true,
    }) satisfies FinalPublicProof;
    const transcript = events.map((event) => [
      event.kind,
      event.proof_sha256,
      event.milliseconds,
    ]);
    const authorityProof = Object.freeze({
      schema: "agenttool-phase-b-refence-final-authority/v1",
      checkpoint: "final",
      target_revision: request.targetRevision,
      target_tree: request.targetTree,
      authority_state: "absent_fail_closed",
      authority_pair_count: 8,
      authority_sandwich_sha256: digest(canonical([
        transcript,
        {
          database_federation_updated_at: request.databaseUpdatedAt,
          database_instance_url_sha256: request.databaseInstanceURLSHA256,
          database_target_sha256: request.databaseTargetSHA256,
        },
      ])),
      local_evidence_sha256: events[0]!.proof_sha256!,
      git_proof_sha256: events[1]!.proof_sha256!,
      keychain_proof_sha256: events[2]!.proof_sha256!,
      provider_inventory_sha256: events[3]!.proof_sha256!,
      process_proof_sha256: events[4]!.proof_sha256!,
      stable_fleet_sha256: events[5]!.proof_sha256!,
      public_proof_sha256: digest(canonical(publicProof)),
      database_observation_count: 1,
      database_proof_sha256: events[8]!.proof_sha256!,
      database_instance_url_sha256: request.databaseInstanceURLSHA256,
      database_federation_updated_at: request.databaseUpdatedAt,
      database_target_sha256: request.databaseTargetSHA256,
      verified: true,
    }) satisfies FinalAuthorityProof;
    return Object.freeze({ publicProof, authorityProof });
  };
  const runFirstCanaryPublicCore = async (
    request: FirstCanaryPublicCoreRequest,
  ): Promise<FirstCanaryPublicProof> => {
    require(
      request.evidence.edge === "H5" &&
        validSHA(request.expectedFleetSHA256),
      "controller_first_canary_admission",
    );
    requireExpectation(request.evidence, request.expectation);
    const applicationIDs = apps(request.evidence);
    const machineIDs = machines(request.evidence);
    require(
      sameSet(request.expectation.targetImageMachineIDs, machineIDs) &&
        sameSet(request.expectation.restartRestoredMachineIDs, machineIDs) &&
        sameSet(
          request.expectation.autostartEnabledAppMachineIDs,
          applicationIDs,
        ) &&
        sameSet(request.expectation.startedMachineIDs, [
          ...applicationIDs,
          request.evidence.roles.thinker_primary,
        ]) &&
        canonical(request.expectation.uncordonedAppMachineIDs) ===
          canonical([request.evidence.roles.app_lhr[0]]),
      "controller_first_canary_expectation",
    );
    const events: PublicGateEvent[] = [];
    const fleetBefore = await request.dependencies.readFleetProof();
    require(
      fleetBefore === request.expectedFleetSHA256,
      "controller_first_canary_fleet",
    );
    events.push({
      kind: "fleet_before",
      proof_sha256: fleetBefore,
      milliseconds: null,
    });
    let priorAboutSettledAtUnixMs: number | null = null;
    for (let round = 0; round < 3; round += 1) {
      const health = await request.dependencies.readPublicJson(
        PUBLIC_HEALTH_URL,
        `first_canary_health_${round}`,
      );
      require(
        priorAboutSettledAtUnixMs === null ||
          (Number.isSafeInteger(priorAboutSettledAtUnixMs) &&
            priorAboutSettledAtUnixMs <= Number.MAX_SAFE_INTEGER - 2_000 &&
            health.observationStartedAtUnixMs >=
              priorAboutSettledAtUnixMs + 2_000),
        "controller_first_canary_pause",
      );
      events.push({
        kind: `health_${round}`,
        proof_sha256: validatePublicHealth(
          health,
          request.evidence.targetRevision,
        ),
        milliseconds: null,
      });
      const about = await request.dependencies.readPublicJson(
        PUBLIC_ABOUT_URL,
        `first_canary_about_${round}`,
      );
      require(
        about.observationStartedAtUnixMs >=
          health.observationSettledAtUnixMs,
        "controller_first_canary_clock",
      );
      events.push({
        kind: `about_${round}`,
        proof_sha256: validatePublicFederationAbout(about),
        milliseconds: null,
      });
      priorAboutSettledAtUnixMs = about.observationSettledAtUnixMs;
      if (round < 2) {
        await request.dependencies.pause(2_000);
        events.push({ kind: "pause", proof_sha256: null, milliseconds: 2_000 });
      }
    }
    const fleetAfter = await request.dependencies.readFleetProof();
    require(
      fleetAfter === request.expectedFleetSHA256,
      "controller_first_canary_fleet",
    );
    events.push({
      kind: "fleet_after",
      proof_sha256: fleetAfter,
      milliseconds: null,
    });
    const proof = validateFirstCanaryPublic({
      targetRevision: request.evidence.targetRevision,
      events,
    });
    require(
      proof.stable_fleet_sha256 === request.expectedFleetSHA256 &&
        proof.verified === true,
      "controller_first_canary_proof",
    );
    return proof;
  };
  const runFinalAuthorityCore = async (
    request: FinalAuthorityCoreRequest,
  ): Promise<{
    publicProofSHA256: string;
    authorityProofSHA256: string;
  }> => {
    require(
      request.evidence.edge === "H5" &&
        validSHA(request.expectedFleetSHA256) &&
        timestampKey(
            request.expectedDatabaseUpdatedAt,
            "controller_final_admission",
          ) >
          timestampKey(
            EXPECTED_FEDERATION_UPDATED_AT,
            "controller_final_admission",
          ),
      "controller_final_admission",
    );
    requireExpectation(request.evidence, request.expectation);
    const applicationIDs = apps(request.evidence);
    const machineIDs = machines(request.evidence);
    require(
      sameSet(request.expectation.targetImageMachineIDs, machineIDs) &&
        sameSet(request.expectation.restartRestoredMachineIDs, machineIDs) &&
        sameSet(
          request.expectation.autostartEnabledAppMachineIDs,
          applicationIDs,
        ) &&
        sameSet(request.expectation.startedMachineIDs, [
          ...applicationIDs,
          request.evidence.roles.thinker_primary,
        ]) &&
        sameSet(request.expectation.uncordonedAppMachineIDs, applicationIDs),
      "controller_final_expectation",
    );
    const events: PublicGateEvent[] = [];
    const event = (kind: string, proofSHA256: string): void => {
      require(validSHA(proofSHA256), "controller_final_event");
      events.push({ kind, proof_sha256: proofSHA256, milliseconds: null });
    };
    const read = async (
      kind: string,
      observation: () => Promise<string>,
    ): Promise<void> => event(kind, await observation());
    const readFleet = async (kind: string): Promise<void> => {
      const proofSHA256 = await request.dependencies.readFleetProof();
      require(
        proofSHA256 === request.expectedFleetSHA256,
        "controller_final_fleet",
      );
      event(kind, proofSHA256);
    };
    const readHealth = async (kind: string): Promise<void> =>
      event(
        kind,
        validatePublicHealth(
          await request.dependencies.readPublicJson(PUBLIC_HEALTH_URL, kind),
          request.evidence.targetRevision,
        ),
      );
    const readAbout = async (kind: string): Promise<void> =>
      event(
        kind,
        validatePublicFederationAbout(
          await request.dependencies.readPublicJson(PUBLIC_ABOUT_URL, kind),
        ),
      );

    await read("local_before", () => request.dependencies.readEvidenceProof());
    await read("git_before", () => request.dependencies.readGitProof());
    await read(
      "keychain_before",
      () => request.dependencies.readKeychainProof(),
    );
    await read(
      "provider_before",
      () => request.dependencies.readProviderProof(),
    );
    await read(
      "process_before",
      () => request.dependencies.readProcessProof("process_before"),
    );
    await readFleet("fleet_before");
    await readHealth("health_before");
    await readAbout("about_before");
    const database = await request.dependencies.readDatabaseProof();
    require(
      validSHA(database.proofSHA256) &&
        database.instanceURLSHA256 === TARGET_INSTANCE_URL_SHA256 &&
        database.updatedAt === request.expectedDatabaseUpdatedAt &&
        validSHA(database.targetSHA256),
      "controller_final_database",
    );
    event("database", database.proofSHA256);
    await readAbout("about_after");
    await readHealth("health_after");
    await readFleet("fleet_after");
    await read(
      "process_after",
      () => request.dependencies.readProcessProof("process_after"),
    );
    await read(
      "keychain_after",
      () => request.dependencies.readKeychainProof(),
    );
    await read(
      "provider_after",
      () => request.dependencies.readProviderProof(),
    );
    await read("git_after", () => request.dependencies.readGitProof());
    await read("local_after", () => request.dependencies.readEvidenceProof());
    const result = validateFinalAuthority({
      targetRevision: request.evidence.targetRevision,
      targetTree: request.evidence.targetTree,
      expectedDatabaseUpdatedAt: request.expectedDatabaseUpdatedAt,
      databaseInstanceURLSHA256: database.instanceURLSHA256,
      databaseUpdatedAt: database.updatedAt,
      databaseTargetSHA256: database.targetSHA256,
      events,
    });
    const publicProofSHA256 = digest(canonical(result.publicProof));
    const authorityProofSHA256 = digest(canonical(result.authorityProof));
    require(
      result.publicProof.verified === true &&
        result.authorityProof.verified === true &&
        result.authorityProof.public_proof_sha256 === publicProofSHA256 &&
        result.authorityProof.stable_fleet_sha256 ===
          request.expectedFleetSHA256,
      "controller_final_proof",
    );
    return { publicProofSHA256, authorityProofSHA256 };
  };
  const runStoppedFenceCore = async (
    request: StoppedFenceCoreRequest,
  ): Promise<Row> => {
    require(
      validSHA(request.receiptSHA256) &&
        validRevision(request.targetRevision) &&
        validRevision(request.targetTree) &&
        timestampKey(
            request.expectedDatabaseUpdatedAt,
            "controller_stopped_fence_admission",
          ) >
          timestampKey(
            EXPECTED_FEDERATION_UPDATED_AT,
            "controller_stopped_fence_admission",
          ) &&
        validSHA(request.expectedFleetSHA256),
      "controller_stopped_fence_admission",
    );
    require(
      request.expectation.restartRestoredMachineIDs.length === 0 &&
        request.expectation.autostartEnabledAppMachineIDs.length === 0 &&
        request.expectation.startedMachineIDs.length === 0 &&
        request.expectation.uncordonedAppMachineIDs.length === 0 &&
        (request.image !== null ||
          request.expectation.targetImageMachineIDs.length === 0),
      "controller_stopped_fence_expectation",
    );
    const localBefore = await request.dependencies.readEvidenceProof();
    const evidence = localBefore.evidence;
    require(
      evidence.edge === "H5" &&
        evidence.receiptSHA256 === request.receiptSHA256 &&
        evidence.targetRevision === request.targetRevision &&
        evidence.targetTree === request.targetTree &&
        validSHA(localBefore.fingerprint),
      "controller_stopped_fence_evidence",
    );
    requireExpectation(evidence, request.expectation);
    const gitBefore = await request.dependencies.readGitProof();
    const databaseBefore = await request.dependencies.readDatabaseProof();
    const providerBefore = await request.dependencies.readProviderProof();
    const keychainBefore = await request.dependencies.readKeychainProof();
    const processBefore = await request.dependencies.readProcessProof();
    const firstFleet = await request.dependencies.readFleetProof();
    await request.dependencies.pause(
      PRODUCER_STABLE_FLEET_INTERVAL_MILLISECONDS,
    );
    const secondFleet = await request.dependencies.readFleetProof();
    const processAfter = await request.dependencies.readProcessProof();
    const keychainAfter = await request.dependencies.readKeychainProof();
    const providerAfter = await request.dependencies.readProviderProof();
    const databaseAfter = await request.dependencies.readDatabaseProof();
    const gitAfter = await request.dependencies.readGitProof();
    const localAfter = await request.dependencies.readEvidenceProof();
    require(
      localAfter.evidence.edge === "H5" &&
        firstFleet === secondFleet &&
        secondFleet === request.expectedFleetSHA256 &&
        canonical(databaseBefore) === canonical(databaseAfter) &&
        databaseAfter.federation_instance_url_sha256 ===
          TARGET_INSTANCE_URL_SHA256 &&
        databaseAfter.federation_updated_at ===
          request.expectedDatabaseUpdatedAt &&
        canonical(gitBefore) === canonical(gitAfter) &&
        providerBefore === providerAfter &&
        canonical(keychainBefore) === canonical(keychainAfter) &&
        canonical(processBefore) === canonical(processAfter) &&
        localBefore.fingerprint === localAfter.fingerprint &&
        validSHA(providerAfter) &&
        validSHA(processAfter.projection_sha256),
      "controller_stopped_fence_drift",
    );
    return {
      schema: "agenttool-phase-b-refence-target-stopped-fence/v1",
      checkpoint: request.checkpoint,
      receipt_sha256: request.receiptSHA256,
      refence_run_id: localAfter.evidence.runID,
      target_revision: request.targetRevision,
      target_tree: request.targetTree,
      target_image: request.image === null
        ? null
        : structuredClone(request.image),
      target_image_machine_ids: [
        ...request.expectation.targetImageMachineIDs,
      ].sort(),
      stable_fleet_sha256: secondFleet,
      fence_sample_count: 2,
      authority_sandwich_sha256: digest(canonical({
        database_after: databaseAfter,
        database_before: databaseBefore,
        fleet_first: firstFleet,
        fleet_second: secondFleet,
        git_after: gitAfter,
        git_before: gitBefore,
        keychain_after: keychainAfter,
        keychain_before: keychainBefore,
        local_after: localAfter.fingerprint,
        local_before: localBefore.fingerprint,
        process_after: processAfter,
        process_before: processBefore,
        provider_after: providerAfter,
        provider_before: providerBefore,
      })),
      database_instance_url_sha256: TARGET_INSTANCE_URL_SHA256,
      database_federation_updated_at: databaseAfter.federation_updated_at,
      database_target_sha256: databaseAfter.database_target_sha256,
      provider_inventory_sha256: providerAfter,
      process_census_sha256: processAfter.projection_sha256,
      public_surfaces_verified: false,
      public_surfaces_expected_unavailable: true,
      fence_verified: true,
    };
  };
  const runCordonedRuntimeCore = async (
    request: CordonedRuntimeCoreRequest,
  ): Promise<Row> => {
    requireExpectation(request.evidence, request.expectation);
    const applicationIDs = apps(request.evidence);
    const expectedRuntimeIDs = [
      ...applicationIDs,
      request.evidence.roles.thinker_primary,
    ];
    require(
      validSHA(request.expectedFleetSHA256) &&
        sameSet(
          request.expectation.targetImageMachineIDs,
          machines(request.evidence),
        ) &&
        sameSet(
          request.expectation.restartRestoredMachineIDs,
          machines(request.evidence),
        ) &&
        sameSet(
          request.expectation.autostartEnabledAppMachineIDs,
          applicationIDs,
        ) &&
        sameSet(request.expectation.startedMachineIDs, expectedRuntimeIDs) &&
        sameSet(request.startedMachineIDs, expectedRuntimeIDs) &&
        request.expectation.uncordonedAppMachineIDs.length === 0,
      "controller_cordoned_runtime_admission",
    );
    const first = await request.dependencies.readFleetProof();
    await request.dependencies.pause(
      PRODUCER_STABLE_FLEET_INTERVAL_MILLISECONDS,
    );
    const second = await request.dependencies.readFleetProof();
    require(
      first === second && second === request.expectedFleetSHA256,
      "controller_cordoned_runtime_fleet",
    );
    const probeSHA256: string[] = [];
    for (const machineID of expectedRuntimeIDs) {
      const proofSHA256 = await request.dependencies.runMachineProbe(
        machineID,
        applicationIDs.includes(machineID) ? "app" : "thinker_primary",
      );
      require(validSHA(proofSHA256), "controller_runtime_probe");
      probeSHA256.push(proofSHA256);
    }
    const third = await request.dependencies.readFleetProof();
    await request.dependencies.pause(
      PRODUCER_STABLE_FLEET_INTERVAL_MILLISECONDS,
    );
    const fourth = await request.dependencies.readFleetProof();
    require(
      third === fourth && fourth === second,
      "controller_cordoned_runtime_fleet",
    );
    return {
      schema: "agenttool-phase-b-refence-cordoned-runtime/v1",
      receipt_sha256: request.evidence.receiptSHA256,
      refence_run_id: request.evidence.runID,
      target_revision: request.evidence.targetRevision,
      target_tree: request.evidence.targetTree,
      target_image: structuredClone(request.image),
      stable_fleet_sha256: fourth,
      fleet_sample_count: 4,
      runtime_machine_ids: [...expectedRuntimeIDs],
      runtime_probe_count: 4,
      runtime_probe_sha256: digest(canonical(probeSHA256)),
      apps_loopback_health_verified: true,
      thinker_primary_database_verified: true,
      public_surfaces_verified: false,
      cordon_verified: true,
    };
  };
  const bridgeMarkerProjection = (
    value: Row,
    excluded: ReadonlySet<string>,
  ): Row =>
    Object.fromEntries(
      Object.entries(value).filter(([key]) => !excluded.has(key)),
    );
  const requireBridgeMarkerShape = (raw: unknown, code: string): Row => {
    const marker = exact(raw, BRIDGE_MARKER_KEYS, code);
    exact(marker.role_mapping, BRIDGE_ROLE_KEYS, code);
    validateDatabaseConvergenceMarker(marker.database_convergence);
    exact(marker.deploy_lock, BRIDGE_LOCK_KEYS, code);
    exact(marker.build_context, BRIDGE_BUILD_CONTEXT_KEYS, code);
    exact(marker.dependency_estate, BRIDGE_DEPENDENCY_ESTATE_KEYS, code);
    exact(marker.child_wal, BRIDGE_CHILD_WAL_KEYS, code);
    exact(marker.guard_proofs, BRIDGE_GUARD_KEYS, code);
    exact(marker.public_proofs, BRIDGE_PUBLIC_KEYS, code);
    exact(marker.success_receipt, BRIDGE_SUCCESS_RECEIPT_KEYS, code);
    exact(
      marker.success_finalization,
      BRIDGE_SUCCESS_FINALIZATION_KEYS,
      code,
    );
    exact(marker.runtime_pins, BRIDGE_RUNTIME_PIN_KEYS, code);
    exact(marker.refence_handoff, BRIDGE_HANDOFF_KEYS, code);
    require(
      marker.schema === "agenttool-maintenance-refence-run/v1" &&
        typeof marker.started_at === "string" &&
        typeof marker.updated_at === "string" &&
        Array.isArray(marker.expected_machine_ids) &&
        Array.isArray(marker.caveats) &&
        canonical(marker.caveats) === canonical(BRIDGE_CAVEATS),
      code,
    );
    timestampKey(marker.started_at, code);
    timestampKey(marker.updated_at, code);
    require(
      timestampKey(marker.updated_at, code) >=
        timestampKey(marker.started_at, code),
      code,
    );
    return marker;
  };
  const bridgeMarkerSuccessAuthorityProjection = (value: Row): Row =>
    immutable(bridgeMarkerProjection(
      requireBridgeMarkerShape(value, "success_authority_marker"),
      SUCCESS_AUTHORITY_EXCLUDED_MARKER_KEYS,
    ));
  const markerWalAuthorityProjection = (raw: unknown, code: string): Row => {
    const wal = exact(raw, BRIDGE_CHILD_WAL_KEYS, code);
    require(
      wal.schema ===
        "agenttool-phase-b-refence-maintenance-child-wal/v1",
      code,
    );
    const { schema: _schema, ...projection } = wal;
    return projection;
  };
  const validateBridgeMarkerTransition = (
    current: Row,
    next: Row,
  ): void => {
    const currentMarker = row(current, "bridge_marker_immutable_binding");
    const nextMarker = row(next, "bridge_marker_immutable_binding");
    const currentFinalization = row(
      currentMarker.success_finalization,
      "bridge_marker_success_finalization",
    );
    const nextFinalization = row(
      nextMarker.success_finalization,
      "bridge_marker_success_finalization",
    );
    const currentInitial =
      currentFinalization.authority_projection_sha256 === null &&
      currentFinalization.witness_path === null &&
      currentFinalization.marker_retirement_claim_path === null &&
      currentFinalization.receipt_pending === false &&
      currentFinalization.marker_retirement_authorized === false;
    const unchanged = canonical(currentFinalization) ===
      canonical(nextFinalization);
    const began = currentInitial &&
      validSHA(nextFinalization.authority_projection_sha256) &&
      typeof nextFinalization.witness_path === "string" &&
      typeof nextFinalization.marker_retirement_claim_path === "string" &&
      nextFinalization.receipt_pending === true &&
      nextFinalization.marker_retirement_authorized === true;
    require(
      (currentInitial && unchanged) || began,
      "bridge_marker_success_finalization_transition",
    );
    require(
      canonical(bridgeMarkerProjection(
            currentMarker,
            BRIDGE_MARKER_MUTABLE_KEYS,
          )) ===
          canonical(bridgeMarkerProjection(
            nextMarker,
            BRIDGE_MARKER_MUTABLE_KEYS,
          )) &&
        typeof currentMarker.updated_at === "string" &&
        typeof nextMarker.updated_at === "string" &&
        nextMarker.updated_at >= currentMarker.updated_at,
      "bridge_marker_immutable_binding",
    );
  };
  const applyRecoveryMarkerTransition = (
    value: Row,
    operation: FlyOperation,
    roles: ContractEvidence["roles"],
    recoveryActive: boolean,
  ): void => {
    if (!recoveryActive || !("machineID" in operation)) return;
    const machineID = operation.machineID;
    const expectedMachineIDs = [
      ...roles.app_lhr,
      roles.app_cdg,
      roles.thinker_primary,
      roles.thinker_standby,
    ];
    require(
      expectedMachineIDs.every(validID) &&
        new Set(expectedMachineIDs).size === 5 &&
        expectedMachineIDs.includes(machineID),
      "controller_recovery_marker",
    );
    const add = (key: string): void => {
      const previous = value[key];
      require(
        Array.isArray(previous) && previous.every(validID),
        "controller_recovery_marker",
      );
      value[key] = [...new Set([...previous, machineID])].sort();
    };
    if (operation.kind === "cordon") {
      require(
        [...roles.app_lhr, roles.app_cdg].includes(machineID),
        "controller_recovery_marker",
      );
      add("recovery_cordon_attempted_app_machine_ids");
      add("recovery_cordoned_app_machine_ids");
    }
    if (
      operation.kind === "refence_app" ||
      operation.kind === "refence_primary" ||
      operation.kind === "refence_standby"
    ) {
      add("recovery_refenced_machine_ids");
    }
  };
  const createSuccessAuthorityProjection = (
    request: SuccessAuthorityRequest,
  ): SuccessAuthorityProjection => {
    const stateDirectory =
      "/Users/yournameisai/.local/state/agenttool/deploy-state";
    timestampKey(request.successProvenAt, "success_authority_contract");
    require(
      /^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/
        .test(request.successProvenAt) &&
        validRunID(request.controllerRunID) &&
        /^maintenance-refence-[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{16}$/
          .test(request.rolloutID) &&
        validSHA(request.refenceReceiptSHA256) &&
        validRevision(request.sourceRevision) &&
        validRevision(request.sourceTree) &&
        validSHA(request.deployLockSHA256) &&
        validSHA(request.earlyGuardSHA256),
      "success_authority_contract",
    );
    const roles = request.roles;
    const applicationIDs = [
      roles.app_lhr[0],
      roles.app_lhr[1],
      roles.app_cdg,
    ];
    const machineIDs = [
      ...applicationIDs,
      roles.thinker_primary,
      roles.thinker_standby,
    ];
    require(
      machineIDs.every(validID) && new Set(machineIDs).size === 5,
      "success_authority_roles",
    );
    const marker = requireBridgeMarkerShape(
      request.marker,
      "success_authority_marker",
    );
    const deployLock = exact(
      request.deployLock,
      BRIDGE_LOCK_KEYS,
      "success_authority_lock",
    );
    require(
      canonical(marker.deploy_lock) === canonical(deployLock) &&
        deployLock.schema === "agenttool-local-deploy-lock/v1" &&
        deployLock.public_path ===
          "/Users/yournameisai/.local/state/agenttool/deploy.lock" &&
        typeof deployLock.owner_record === "string" &&
        deployLock.owner_record.startsWith(
          "/Users/yournameisai/.local/state/agenttool/",
        ) &&
        /^\.deploy-lock-owner\.refence-[1-9][0-9]*-[0-9a-f]{16}$/.test(
          deployLock.owner_record.slice(
            "/Users/yournameisai/.local/state/agenttool/".length,
          ),
        ) && Number.isSafeInteger(deployLock.device) &&
        deployLock.device >= 0 && Number.isSafeInteger(deployLock.inode) &&
        deployLock.inode > 0 && validSHA(deployLock.sha256) &&
        deployLock.sha256 === request.deployLockSHA256 &&
        Number.isSafeInteger(deployLock.pid) && deployLock.pid > 1,
      "success_authority_lock",
    );
    const markerAuthority = bridgeMarkerSuccessAuthorityProjection(marker);
    const databaseConvergence = exact(
      request.databaseConvergence,
      DATABASE_CONVERGENCE_KEYS,
      "success_authority_database",
    );
    validateDatabaseConvergenceMarker(databaseConvergence);
    const expectedApps = [...applicationIDs].sort();
    const expectedIDs = [...machineIDs].sort();
    const markerRoles = row(marker.role_mapping, "success_authority_roles");
    require(
      marker.controller_run_id === request.controllerRunID &&
        marker.rollout_id === request.rolloutID &&
        marker.source_revision === request.sourceRevision &&
        marker.source_tree === request.sourceTree &&
        canonical(marker.expected_machine_ids) === canonical(expectedIDs) &&
        canonical(markerRoles.app_machine_ids) === canonical(expectedApps) &&
        markerRoles.thinker_primary_machine_id === roles.thinker_primary &&
        markerRoles.thinker_standby_machine_id === roles.thinker_standby &&
        canonical(marker.database_convergence) ===
          canonical(databaseConvergence) &&
        databaseConvergence.status === "verified" &&
        databaseConvergence.verified === true &&
        databaseConvergence.commit_state === "acknowledged" &&
        databaseConvergence.reconciliation_required === false &&
        databaseConvergence.database_write_attempt_count === 1 &&
        databaseConvergence.rows_updated === 1 &&
        databaseConvergence.rollback_attempt_count === 0,
      "success_authority_database",
    );
    const buildContext = exact(
      request.buildContext,
      BRIDGE_BUILD_CONTEXT_KEYS,
      "success_authority_build_context",
    );
    const dependencyEstate = exact(
      request.dependencyEstate,
      BRIDGE_DEPENDENCY_ESTATE_KEYS,
      "success_authority_dependency_estate",
    );
    const refenceHandoff = exact(
      request.refenceHandoff,
      BRIDGE_HANDOFF_KEYS,
      "success_authority_handoff",
    );
    const authorizedH0 = exact(
      refenceHandoff.authorized_h0,
      BRIDGE_AUTHORIZED_H0_KEYS,
      "success_authority_handoff",
    );
    const priorFailedCompatibilityController = exact(
      refenceHandoff.prior_failed_compatibility_controller,
      BRIDGE_PRIOR_FAILED_COMPATIBILITY_CONTROLLER_KEYS,
      "success_authority_handoff",
    );
    const compatibilityController = exact(
      refenceHandoff.compatibility_controller,
      BRIDGE_COMPATIBILITY_CONTROLLER_KEYS,
      "success_authority_handoff",
    );
    const priorChangedPathStatuses = [
      { old_mode: "100755", new_mode: "100755", status: "M", path: "bin/deploy.sh" },
      { old_mode: "100644", new_mode: "100644", status: "M", path: "bin/phase-b-refence-maintenance-bridge.ts" },
      { old_mode: "100644", new_mode: "100644", status: "M", path: "bin/phase-b-refence-maintenance-contract.ts" },
      { old_mode: "100644", new_mode: "100644", status: "M", path: "bin/tests/phase-b-refence-maintenance-bridge.test.ts" },
      { old_mode: "100644", new_mode: "100644", status: "M", path: "bin/tests/phase-b-refence-maintenance-dispatcher.test.ts" },
      { old_mode: "100644", new_mode: "100644", status: "M", path: "packages/constructive-intelligence/tests/concurrency.test.ts" },
    ];
    const repairChangedPathStatuses = priorChangedPathStatuses.slice(0, 5);
    require(
      canonical(marker.build_context) === canonical(buildContext) &&
        canonical(marker.dependency_estate) === canonical(dependencyEstate) &&
        canonical(marker.refence_handoff) === canonical(refenceHandoff) &&
        buildContext.schema ===
          "agenttool-phase-b-refence-build-context/v1" &&
        buildContext.source_revision === request.sourceRevision &&
        buildContext.source_tree === request.sourceTree &&
        buildContext.prepared === true &&
        dependencyEstate.schema ===
          "agenttool-phase-b-refence-dependency-estate/v1" &&
        dependencyEstate.source_revision === request.sourceRevision &&
        dependencyEstate.source_tree === request.sourceTree &&
        dependencyEstate.prepared === true &&
        refenceHandoff.proof_schema ===
          "agenttool-phase-b-refence-handoff/v3" &&
        refenceHandoff.refence_receipt_sha256 ===
          request.refenceReceiptSHA256 &&
        refenceHandoff.refence_run_id === request.controllerRunID &&
        refenceHandoff.target_revision === request.sourceRevision &&
        refenceHandoff.target_tree === request.sourceTree &&
        authorizedH0.schema === "agenttool-phase-b-refence-authorized-h0/v1" &&
        authorizedH0.receipt_sha256 === request.refenceReceiptSHA256 &&
        authorizedH0.receipt_sha256 ===
          "8b5bb36641fb210ee9ecb542d5adb3cfcb99adb76af369715aa32805e3e18077" &&
        authorizedH0.run_id === request.controllerRunID &&
        authorizedH0.run_id === "789e8486-47cb-4b80-a165-c5ea557082d6" &&
        authorizedH0.target_revision === request.sourceRevision &&
        authorizedH0.target_revision ===
          "d87a3f35c80bdac39402e1c34dfebe643a18beb6" &&
        authorizedH0.target_tree === request.sourceTree &&
        authorizedH0.target_tree ===
          "0b5881546a39e328b8299cf9bbfde8d25b15580b" &&
        authorizedH0.target_distance === 47 &&
        authorizedH0.lifecycle === "historical" &&
        authorizedH0.guard_revision === authorizedH0.target_revision &&
        authorizedH0.guard_source_path ===
          "bin/phase-b-refence-maintenance-bridge.ts" &&
        authorizedH0.guard_raw_sha256 ===
          "dd324e32fada2053acc945d39012d5844caef402ad82f013b27b18d3ddb275ae" &&
        authorizedH0.guard_normalized_sha256 ===
          "9e0ddd120fa6d605f68a86be35303a1b2eba56155116218933f8801eda47340c" &&
        authorizedH0.contract_revision === authorizedH0.target_revision &&
        authorizedH0.contract_source_path ===
          "bin/phase-b-refence-maintenance-contract.ts" &&
        authorizedH0.contract_raw_sha256 ===
          "0c7ad30f81271b42a2339fcf1f87705c1ff6ee4a5906506f8a2c089ab92e74a1" &&
        authorizedH0.contract_git_blob ===
          "ea83765c054b3bf130a4c8957a5a30ef1e657cb6" &&
        priorFailedCompatibilityController.schema ===
          "agenttool-phase-b-refence-prior-failed-protected-successor-controller/v1" &&
        priorFailedCompatibilityController.lifecycle === "failed_pre_h" &&
        priorFailedCompatibilityController.controller_success === false &&
        priorFailedCompatibilityController.mutation_effect_began === false &&
        priorFailedCompatibilityController.success_authority === false &&
        priorFailedCompatibilityController.effect_authority === false &&
        priorFailedCompatibilityController.observed_first_refusal_predicate === false &&
        priorFailedCompatibilityController.static_refusal_barrier ===
          "raw_commit_terminal_lf_required" &&
        priorFailedCompatibilityController.static_refusal_barrier_verified === true &&
        priorFailedCompatibilityController.controller_revision ===
          "e4b9ed4188ad1f01cfaa6bb5385d21d53625fa73" &&
        priorFailedCompatibilityController.controller_tree ===
          "87face598df18f71ecda4997a82e0f49934b8166" &&
        priorFailedCompatibilityController.controller_source_distance === 51 &&
        priorFailedCompatibilityController.commit_raw_sha256 ===
          "399dccbf17db1805f48e10d77068bb5130fc5fb03b12094445942fe01980a891" &&
        priorFailedCompatibilityController.commit_byte_count === 1246 &&
        priorFailedCompatibilityController.first_parent_revision ===
          authorizedH0.target_revision &&
        priorFailedCompatibilityController.second_parent_revision ===
          "8e644fb52da22badcd6da6cd2324291e1d37f656" &&
        priorFailedCompatibilityController.second_parent_tree ===
          priorFailedCompatibilityController.controller_tree &&
        priorFailedCompatibilityController.protected_predecessor_tree ===
          authorizedH0.target_tree &&
        priorFailedCompatibilityController.bridge_revision ===
          priorFailedCompatibilityController.controller_revision &&
        priorFailedCompatibilityController.bridge_source_path ===
          "bin/phase-b-refence-maintenance-bridge.ts" &&
        priorFailedCompatibilityController.bridge_source_sha256 ===
          "6be6664c2dee86ac427dda893a7f2aa51ee639951e00a6e802c60f98fa153f5c" &&
        priorFailedCompatibilityController.bridge_normalized_sha256 ===
          "539b4711da2628946a6592944ab0ea9da40db711accdbe412520267540c41c8e" &&
        priorFailedCompatibilityController.contract_revision ===
          priorFailedCompatibilityController.controller_revision &&
        priorFailedCompatibilityController.contract_source_path ===
          "bin/phase-b-refence-maintenance-contract.ts" &&
        priorFailedCompatibilityController.contract_source_sha256 ===
          "e1b05bcdaa7e7775cb7156660e87d65a0e9bba0a54b8cb1f0cc062f1b14aea14" &&
        priorFailedCompatibilityController.contract_git_blob ===
          "c543e1e79f1efd1d24fbf2de539884b0f44b4e9a" &&
        canonical(priorFailedCompatibilityController.changed_path_statuses) ===
          canonical(priorChangedPathStatuses) &&
        priorFailedCompatibilityController.changed_path_statuses_sha256 ===
          digest(canonical(priorChangedPathStatuses)) &&
        priorFailedCompatibilityController.changed_path_statuses_sha256 ===
          "211620ae73940844daa44dad70dec9026d4f9759ea9abda4706abdc41ef81698" &&
        priorFailedCompatibilityController.payload_revision === authorizedH0.target_revision &&
        priorFailedCompatibilityController.payload_tree === authorizedH0.target_tree &&
        priorFailedCompatibilityController.payload_distance === authorizedH0.target_distance &&
        compatibilityController.schema ===
          "agenttool-phase-b-refence-protected-successor-controller/v2" &&
        compatibilityController.lifecycle === "current" &&
        refenceHandoff.bridge_source_path ===
          "/Users/yournameisai/.cache/codex-worktrees/agenttool-phase-b-refence-maintenance-bridge-v1/bin/phase-b-refence-maintenance-bridge.ts" &&
        compatibilityController.bridge_source_path ===
          refenceHandoff.bridge_source_path &&
        compatibilityController.bridge_source_sha256 ===
          refenceHandoff.bridge_source_sha256 &&
        compatibilityController.bridge_normalized_sha256 ===
          refenceHandoff.bridge_normalized_sha256 &&
        validSHA(refenceHandoff.bridge_source_sha256) &&
        validSHA(refenceHandoff.bridge_normalized_sha256) &&
        compatibilityController.bridge_source_sha256 !==
          authorizedH0.guard_raw_sha256 &&
        compatibilityController.bridge_normalized_sha256 !==
          authorizedH0.guard_normalized_sha256 &&
        compatibilityController.bridge_source_sha256 !==
          priorFailedCompatibilityController.bridge_source_sha256 &&
        compatibilityController.bridge_normalized_sha256 !==
          priorFailedCompatibilityController.bridge_normalized_sha256 &&
        compatibilityController.contract_source_path ===
          "/Users/yournameisai/.cache/codex-worktrees/agenttool-phase-b-refence-maintenance-bridge-v1/bin/phase-b-refence-maintenance-contract.ts" &&
        validSHA(compatibilityController.contract_source_sha256) &&
        validRevision(compatibilityController.contract_git_blob) &&
        compatibilityController.contract_source_sha256 !==
          authorizedH0.contract_raw_sha256 &&
        compatibilityController.contract_git_blob !==
          authorizedH0.contract_git_blob &&
        compatibilityController.contract_source_sha256 !==
          priorFailedCompatibilityController.contract_source_sha256 &&
        compatibilityController.contract_git_blob !==
          priorFailedCompatibilityController.contract_git_blob &&
        validRevision(compatibilityController.controller_revision) &&
        compatibilityController.controller_revision !==
          authorizedH0.target_revision &&
        compatibilityController.controller_revision !==
          priorFailedCompatibilityController.controller_revision &&
        validRevision(compatibilityController.controller_tree) &&
        compatibilityController.controller_tree !== authorizedH0.target_tree &&
        compatibilityController.controller_tree !==
          priorFailedCompatibilityController.controller_tree &&
        Number.isSafeInteger(compatibilityController.controller_source_distance) &&
        compatibilityController.controller_source_distance >
          priorFailedCompatibilityController.controller_source_distance &&
        validSHA(compatibilityController.commit_raw_sha256) &&
        Number.isSafeInteger(compatibilityController.commit_byte_count) &&
        compatibilityController.commit_byte_count > 0 &&
        compatibilityController.commit_byte_count <= 1000000 &&
        compatibilityController.predecessor_controller_revision ===
          priorFailedCompatibilityController.controller_revision &&
        compatibilityController.first_parent_revision ===
          priorFailedCompatibilityController.controller_revision &&
        validRevision(compatibilityController.second_parent_revision) &&
        compatibilityController.second_parent_revision !==
          compatibilityController.controller_revision &&
        compatibilityController.second_parent_revision !==
          compatibilityController.first_parent_revision &&
        compatibilityController.second_parent_revision !==
          authorizedH0.target_revision &&
        compatibilityController.second_parent_tree ===
          compatibilityController.controller_tree &&
        compatibilityController.protected_predecessor_tree ===
          priorFailedCompatibilityController.controller_tree &&
        compatibilityController.exact_first_parent_verified === true &&
        compatibilityController.second_parent_tree_verified === true &&
        compatibilityController.protected_head_verified === true &&
        canonical(compatibilityController.repair_changed_path_statuses) ===
          canonical(repairChangedPathStatuses) &&
        compatibilityController.repair_changed_path_statuses_sha256 ===
          digest(canonical(repairChangedPathStatuses)) &&
        compatibilityController.repair_changed_path_statuses_sha256 ===
          "f0a1b1436517bd4179410889a12def8fc447b9dc1772001196b5d0a6c05ad88e" &&
        canonical(compatibilityController.cumulative_changed_path_statuses) ===
          canonical(priorChangedPathStatuses) &&
        compatibilityController.cumulative_changed_path_statuses_sha256 ===
          digest(canonical(priorChangedPathStatuses)) &&
        compatibilityController.cumulative_changed_path_statuses_sha256 ===
          "211620ae73940844daa44dad70dec9026d4f9759ea9abda4706abdc41ef81698" &&
        compatibilityController.payload_revision ===
          authorizedH0.target_revision &&
        compatibilityController.payload_tree === authorizedH0.target_tree &&
        compatibilityController.payload_distance === authorizedH0.target_distance &&
        refenceHandoff.anchor_archive_path ===
          request.retainedArchives.anchor.path &&
        refenceHandoff.anchor_sha256 ===
          request.retainedArchives.anchor.sha256 &&
        refenceHandoff.anchor_device ===
          request.retainedArchives.anchor.device &&
        refenceHandoff.anchor_inode ===
          request.retainedArchives.anchor.inode &&
        refenceHandoff.witness_archive_path ===
          request.retainedArchives.witness.path &&
        refenceHandoff.witness_sha256 ===
          request.retainedArchives.witness.sha256 &&
        refenceHandoff.witness_device ===
          request.retainedArchives.witness.device &&
        refenceHandoff.witness_inode ===
          request.retainedArchives.witness.inode,
      "success_authority_handoff",
    );
    const archives = exact(
      request.retainedArchives,
      ["anchor", "witness"],
      "success_authority_archives",
    );
    for (const [kind, raw] of Object.entries(archives)) {
      const archiveKind = kind === "anchor" ? "anchor" : "armed-witness";
      const archive = exact(
        raw,
        ["path", "sha256", "device", "inode", "nlink"],
        "success_authority_archives",
      );
      require(
        archive.path ===
            `${stateDirectory}/phase-b-refence-observed-526-${archiveKind}-retired-${request.controllerRunID}.json` &&
          validSHA(archive.sha256) && Number.isSafeInteger(archive.device) &&
          archive.device >= 0 && Number.isSafeInteger(archive.inode) &&
          archive.inode > 0 && archive.nlink === 1,
        "success_authority_archives",
      );
    }
    const controllerWal = exact(
      request.controllerWal,
      [
        "directory",
        "entry_count",
        "ordered_filenames",
        "chain_sha256",
        "terminal_entry_sha256",
        "terminal_phase",
      ],
      "success_authority_wal",
    );
    require(
      controllerWal.directory ===
          `${stateDirectory}/phase-b-refence-maintenance-bridge-wal/${request.controllerRunID}` &&
        Number.isSafeInteger(controllerWal.entry_count) &&
        controllerWal.entry_count > 0 &&
        Array.isArray(controllerWal.ordered_filenames) &&
        controllerWal.ordered_filenames.length === controllerWal.entry_count &&
        controllerWal.ordered_filenames.every((name: unknown, index: number) =>
          typeof name === "string" &&
          name.startsWith(`${String(index + 1).padStart(6, "0")}-`) &&
          /^[0-9]{6}-[0-9a-f]{64}\.json$/.test(name)
        ) && validSHA(controllerWal.chain_sha256) &&
        validSHA(controllerWal.terminal_entry_sha256) &&
        controllerWal.terminal_phase === "complete" &&
        canonical(markerWalAuthorityProjection(
            marker.child_wal,
            "success_authority_wal",
          )) === canonical(controllerWal),
      "success_authority_wal",
    );
    const rolloutProofs = exact(
      request.rolloutProofs,
      SUCCESS_ROLLOUT_PROOF_KEYS,
      "success_authority_rollout_proofs",
    );
    require(
      Array.isArray(rolloutProofs.special_guards) &&
        rolloutProofs.special_guards.length === 2 &&
        rolloutProofs.special_guards.every(validSHA) &&
        Array.isArray(rolloutProofs.fly_effects) &&
        rolloutProofs.fly_effects.length === 28 &&
        [
          rolloutProofs.cordoned_runtime_sha256,
          rolloutProofs.public_first_canary_sha256,
          rolloutProofs.public_final_sha256,
          rolloutProofs.final_authority_sha256,
          rolloutProofs.ordinary_absent_postflight_sha256,
        ].every(validSHA),
      "success_authority_rollout_proofs",
    );
    const expectedEffects = [
      ["build_push", "agenttool"],
      ["update_image", roles.thinker_primary],
      ...[...applicationIDs, roles.thinker_standby].map((
        id,
      ) => ["update_image", id]),
      ...applicationIDs.map((id) => ["restore_app", id]),
      ["restore_primary", roles.thinker_primary],
      ["restore_standby", roles.thinker_standby],
      ...applicationIDs.flatMap((id) => [["start", id], ["wait_started", id]]),
      ...applicationIDs.flatMap((id) => [[
        "enable_autostart",
        id,
      ], ["wait_started", id]]),
      ["start", roles.thinker_primary],
      ["wait_started", roles.thinker_primary],
      ...applicationIDs.map((id) => ["uncordon", id]),
    ];
    require(
      canonical(rolloutProofs.fly_effects.map((raw: unknown) => {
        const effect = exact(
          raw,
          ["operation", "target", "proof_sha256"],
          "success_authority_rollout_proofs",
        );
        require(
          validSHA(effect.proof_sha256),
          "success_authority_rollout_proofs",
        );
        return [effect.operation, effect.target];
      })) === canonical(expectedEffects),
      "success_authority_rollout_proofs",
    );
    const guardProofs = row(marker.guard_proofs, "success_authority_marker");
    const publicProofs = row(marker.public_proofs, "success_authority_marker");
    const markerReceipt = row(
      marker.success_receipt,
      "success_authority_marker",
    );
    const markerFinalization = row(
      marker.success_finalization,
      "success_authority_marker",
    );
    const successfulArrays = [
      [marker.attempted_machine_ids, expectedIDs],
      [marker.image_verified_machine_ids, expectedIDs],
      [marker.started_app_machine_ids, expectedApps],
      [marker.autostart_restored_app_machine_ids, expectedApps],
      [marker.uncordon_attempted_app_machine_ids, expectedApps],
      [marker.uncordon_verified_app_machine_ids, expectedApps],
    ];
    require(
      marker.status === "active" &&
        marker.checkpoint === "all_final_gates_verified" &&
        marker.recovery_required === true &&
        marker.manual_finalization_required === false &&
        marker.mutation_effect_began === true && marker.failure_code === null &&
        marker.initial_app_cordon_snapshot_verified === true &&
        marker.initial_cordoned_app_machine_count === 3 &&
        marker.cordoned_runtime_verified === true &&
        marker.thinker_primary_started_verified === true &&
        marker.final_app_uncordon_verified === true &&
        marker.image_tag === request.rolloutID &&
        /^sha256:[0-9a-f]{64}$/.test(marker.image_digest) &&
        successfulArrays.every(([actual, expected]) =>
          canonical(actual) === canonical(expected)
        ) &&
        canonical(marker.recovery_cordon_attempted_app_machine_ids) === "[]" &&
        canonical(marker.recovery_cordoned_app_machine_ids) === "[]" &&
        canonical(marker.recovery_refenced_machine_ids) === "[]" &&
        canonical(marker.deploy_lock) === canonical(deployLock) &&
        guardProofs.early_sha256 === request.earlyGuardSHA256 &&
        guardProofs.prepublication_before_build_sha256 ===
          rolloutProofs.special_guards[0] &&
        guardProofs.prepublication_before_image_sha256 ===
          rolloutProofs.special_guards[1] &&
        guardProofs.final_sha256 ===
          rolloutProofs.final_authority_sha256 &&
        publicProofs.first_canary_sha256 ===
          rolloutProofs.public_first_canary_sha256 &&
        publicProofs.final_sha256 === rolloutProofs.public_final_sha256 &&
        publicProofs.ordinary_postflight_sha256 ===
          rolloutProofs.ordinary_absent_postflight_sha256 &&
        markerReceipt.path === null && markerReceipt.sha256 === null &&
        markerReceipt.durable === false &&
        markerFinalization.schema ===
          "agenttool-phase-b-refence-maintenance-success-finalization/v1" &&
        markerFinalization.authority_projection_sha256 === null &&
        markerFinalization.witness_path === null &&
        markerFinalization.marker_retirement_claim_path === null &&
        markerFinalization.receipt_pending === false &&
        markerFinalization.marker_retirement_authorized === false &&
        timestampKey(request.successProvenAt, "success_authority_contract") >=
          timestampKey(marker.updated_at, "success_authority_marker"),
      "success_authority_marker",
    );
    const finalTruth = exact(
      request.finalTruth,
      SUCCESS_FINAL_TRUTH_KEYS,
      "success_authority_final_truth",
    );
    require(
      finalTruth.schema ===
          "agenttool-phase-b-refence-maintenance-final-truth/v1" &&
        finalTruth.database_convergence_verified === true &&
        finalTruth.target_image_machine_count === 5 &&
        finalTruth.started_service_machine_count === 4 &&
        finalTruth.autostart_enabled_app_count === 3 &&
        finalTruth.uncordoned_app_count === 3 &&
        finalTruth.standby_stopped === true &&
        finalTruth.authority_state === "absent_fail_closed" &&
        finalTruth.ordinary_absent_postflight_verified === true &&
        finalTruth.controller_wal_sealed === true &&
        finalTruth.active_child_count === 0 &&
        finalTruth.effects_closed === true &&
        finalTruth.migration_attempt_count === 0 &&
        finalTruth.database_write_attempt_count === 1 &&
        finalTruth.rollback_attempt_count === 0,
      "success_authority_final_truth",
    );
    const projection: SuccessAuthorityProjection = {
      schema: "agenttool-phase-b-refence-maintenance-success-authority/v1",
      success_proven_at: request.successProvenAt,
      controller_run_id: request.controllerRunID,
      rollout_id: request.rolloutID,
      refence_receipt_sha256: request.refenceReceiptSHA256,
      source_revision: request.sourceRevision,
      source_tree: request.sourceTree,
      marker_authority_sha256: digest(canonical(markerAuthority)),
      database_convergence_sha256: digest(canonical(databaseConvergence)),
      deploy_lock_sha256: request.deployLockSHA256,
      build_context_sha256: digest(canonical(buildContext)),
      dependency_estate_sha256: digest(canonical(dependencyEstate)),
      refence_handoff_sha256: digest(canonical(refenceHandoff)),
      retained_archives: structuredClone(request.retainedArchives),
      controller_wal: structuredClone(controllerWal),
      rollout_proofs: structuredClone(rolloutProofs),
      final_truth: structuredClone(finalTruth),
    };
    exact(projection, SUCCESS_AUTHORITY_KEYS, "success_authority_contract");
    return immutable(projection);
  };
  const previewSuccessFinalizationMarker = (
    request: SuccessFinalizationPreviewRequest,
  ): Row => {
    const stateRoot = "/Users/yournameisai/.local/state/agenttool";
    const stateDirectory = `${stateRoot}/deploy-state`;
    const receiptDirectory = `${stateRoot}/deploy-receipts`;
    const current = requireBridgeMarkerShape(
      request.currentMarker,
      "success_finalization_preview",
    );
    const wal = exact(
      request.walProjection,
      [
        "directory",
        "entry_count",
        "ordered_filenames",
        "chain_sha256",
        "terminal_entry_sha256",
        "terminal_phase",
      ],
      "success_finalization_preview",
    );
    timestampKey(request.successProvenAt, "success_finalization_preview");
    require(
      /^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/
        .test(request.successProvenAt) &&
        validSHA(request.authorityProjectionSHA256) &&
        current.status === "active" &&
        current.checkpoint === "all_final_gates_verified" &&
        current.recovery_required === true &&
        current.manual_finalization_required === false &&
        current.failure_code === null &&
        current.success_receipt.path === null &&
        current.success_receipt.sha256 === null &&
        current.success_receipt.durable === false &&
        current.success_finalization.authority_projection_sha256 === null &&
        current.success_finalization.witness_path === null &&
        current.success_finalization.marker_retirement_claim_path === null &&
        current.success_finalization.receipt_pending === false &&
        current.success_finalization.marker_retirement_authorized === false &&
        wal.terminal_phase === "complete" &&
        canonical(markerWalAuthorityProjection(
            current.child_wal,
            "success_finalization_preview",
          )) === canonical(wal) &&
        request.receiptPath.startsWith(`${receiptDirectory}/`) &&
        request.witnessPath ===
          `${stateDirectory}/phase-b-refence-maintenance-finalization-${current.controller_run_id}.json` &&
        request.markerRetirementClaimPath ===
          `${stateDirectory}/.phase-b-refence-maintenance-marker-retirement-${current.controller_run_id}.claim` &&
        timestampKey(request.successProvenAt, "success_finalization_preview") >=
          timestampKey(current.updated_at, "success_finalization_preview"),
      "success_finalization_preview",
    );
    const next = structuredClone(current);
    next.updated_at = request.successProvenAt;
    next.status = "success_proven_receipt_pending";
    next.checkpoint = "success_proven_receipt_pending";
    next.recovery_required = false;
    next.manual_finalization_required = true;
    next.failure_code = null;
    next.child_wal = {
      schema: "agenttool-phase-b-refence-maintenance-child-wal/v1",
      ...wal,
    };
    next.success_receipt = {
      path: request.receiptPath,
      sha256: null,
      durable: false,
    };
    next.success_finalization = {
      schema: "agenttool-phase-b-refence-maintenance-success-finalization/v1",
      authority_projection_sha256: request.authorityProjectionSHA256,
      witness_path: request.witnessPath,
      marker_retirement_claim_path: request.markerRetirementClaimPath,
      receipt_pending: true,
      marker_retirement_authorized: true,
    };
    requireBridgeMarkerShape(next, "success_finalization_preview");
    return immutable(next);
  };
  const createSuccessArtifacts = (
    request: SuccessArtifactRequest,
  ): SuccessArtifactBundle => {
    const stateRoot = "/Users/yournameisai/.local/state/agenttool";
    const stateDirectory = `${stateRoot}/deploy-state`;
    const receiptDirectory = `${stateRoot}/deploy-receipts`;
    const derivedAuthority = createSuccessAuthorityProjection(
      request.authorityRequest,
    );
    const authority = exact(
      request.authorityProjection,
      SUCCESS_AUTHORITY_KEYS,
      "success_artifact_authority",
    ) as SuccessAuthorityProjection;
    require(
      canonical(authority) === canonical(derivedAuthority),
      "success_artifact_authority",
    );
    const authoritySHA256 = digest(canonical(authority));
    const runID = authority.controller_run_id;
    require(
      validRunID(runID) && request.markerPath ===
          `${stateDirectory}/maintenance-active.json` &&
        request.witnessPath ===
          `${stateDirectory}/phase-b-refence-maintenance-finalization-${runID}.json` &&
        request.markerRetirementClaimPath ===
          `${stateDirectory}/.phase-b-refence-maintenance-marker-retirement-${runID}.claim` &&
        request.lockPublicPath === `${stateRoot}/deploy.lock` &&
        /^\.deploy-lock-owner\.refence-[1-9][0-9]*-[0-9a-f]{16}$/.test(
          request.lockOwnerPath.slice(stateRoot.length + 1),
        ) && request.lockOwnerPath.startsWith(`${stateRoot}/`) &&
        request.receiptPath.startsWith(`${receiptDirectory}/`) &&
        /^20[0-9]{6}T[0-9]{6}Z-[0-9a-f]{12}-[1-9][0-9]*\.json$/.test(
          request.receiptPath.slice(receiptDirectory.length + 1),
        ) &&
        request.receiptPath.slice(
            receiptDirectory.length + 18,
            receiptDirectory.length + 30,
          ) ===
          authority.source_revision.slice(0, 12) &&
        /^(?:0|[1-9][0-9]*)$/.test(request.lockDevice) &&
        /^[1-9][0-9]*$/.test(request.lockInode) &&
        validSHA(request.lockSHA256) &&
        request.lockSHA256 === authority.deploy_lock_sha256,
      "success_artifact_paths",
    );
    require(
      typeof request.markerBytesUTF8 === "string" &&
        request.markerBytesUTF8.endsWith("\n"),
      "success_artifact_marker",
    );
    let markerValue: unknown;
    try {
      markerValue = JSON.parse(request.markerBytesUTF8);
    } catch {
      return refuse("success_artifact_marker");
    }
    const marker = requireBridgeMarkerShape(
      markerValue,
      "success_artifact_marker",
    );
    const markerAuthority = bridgeMarkerSuccessAuthorityProjection(marker);
    require(
      `${canonical(marker)}\n` === request.markerBytesUTF8 &&
        marker.schema === "agenttool-maintenance-refence-run/v1" &&
        marker.controller_run_id === runID &&
        marker.rollout_id === authority.rollout_id &&
        marker.source_revision === authority.source_revision &&
        marker.source_tree === authority.source_tree &&
        marker.status === "success_proven_receipt_pending" &&
        marker.checkpoint === "success_proven_receipt_pending" &&
        marker.recovery_required === false &&
        marker.manual_finalization_required === true &&
        marker.failure_code === null &&
        marker.updated_at === authority.success_proven_at &&
        digest(canonical(markerAuthority)) ===
          authority.marker_authority_sha256 &&
        marker.deploy_lock.public_path === request.lockPublicPath &&
        marker.deploy_lock.owner_record === request.lockOwnerPath &&
        String(marker.deploy_lock.device) === request.lockDevice &&
        String(marker.deploy_lock.inode) === request.lockInode &&
        marker.deploy_lock.sha256 === request.lockSHA256,
      "success_artifact_marker",
    );
    const markerFinalization = exact(
      marker.success_finalization,
      [
        "schema",
        "authority_projection_sha256",
        "witness_path",
        "marker_retirement_claim_path",
        "receipt_pending",
        "marker_retirement_authorized",
      ],
      "success_artifact_marker",
    );
    const markerReceipt = exact(
      marker.success_receipt,
      ["path", "sha256", "durable"],
      "success_artifact_marker",
    );
    require(
      markerFinalization.schema ===
          "agenttool-phase-b-refence-maintenance-success-finalization/v1" &&
        markerFinalization.authority_projection_sha256 === authoritySHA256 &&
        markerFinalization.witness_path === request.witnessPath &&
        markerFinalization.marker_retirement_claim_path ===
          request.markerRetirementClaimPath &&
        markerFinalization.receipt_pending === true &&
        markerFinalization.marker_retirement_authorized === true &&
        markerReceipt.path === request.receiptPath &&
        markerReceipt.sha256 === null && markerReceipt.durable === false &&
        canonical(markerWalAuthorityProjection(
            marker.child_wal,
            "success_artifact_marker",
          )) === canonical(authority.controller_wal),
      "success_artifact_marker",
    );
    const markerSHA256 = digest(request.markerBytesUTF8);
    const witness = {
      schema: "agenttool-phase-b-refence-maintenance-finalization/v1",
      run_id: runID,
      rollout_id: authority.rollout_id,
      source_revision: authority.source_revision,
      source_tree: authority.source_tree,
      success_proven_at: authority.success_proven_at,
      authority_projection: structuredClone(authority),
      authority_projection_sha256: authoritySHA256,
      marker_path: request.markerPath,
      marker_bytes_utf8: request.markerBytesUTF8,
      marker_sha256: markerSHA256,
      marker_retirement_claim_path: request.markerRetirementClaimPath,
      receipt_path: request.receiptPath,
      lock_public_path: request.lockPublicPath,
      lock_owner_path: request.lockOwnerPath,
      lock_device: request.lockDevice,
      lock_inode: request.lockInode,
      lock_sha256: request.lockSHA256,
      truth: {
        receipt_exact_and_durable: true,
        marker_canonical_absent_and_directory_fsynced: true,
        marker_retirement_claim_retained_at_install: true,
        same_original_lock_inode_held: true,
        lock_cleanup_authorized: true,
        lock_absence_claimed: false,
      },
    };
    exact(witness, SUCCESS_WITNESS_KEYS, "success_artifact_witness");
    exact(
      witness.truth,
      SUCCESS_WITNESS_TRUTH_KEYS,
      "success_artifact_witness",
    );
    const witnessBytesUTF8 = `${canonical(witness)}\n`;
    const witnessSHA256 = digest(witnessBytesUTF8);
    const receipt = {
      schema: "agenttool-deploy-receipt/v8",
      run_id: runID,
      rollout_id: authority.rollout_id,
      source_revision: authority.source_revision,
      source_tree: authority.source_tree,
      success_proven_at: authority.success_proven_at,
      authority_projection: structuredClone(authority),
      authority_projection_sha256: authoritySHA256,
      marker_path: request.markerPath,
      marker_bytes_utf8: request.markerBytesUTF8,
      marker_sha256: markerSHA256,
      witness_path: request.witnessPath,
      witness_bytes_utf8: witnessBytesUTF8,
      witness_sha256: witnessSHA256,
      lock_device: request.lockDevice,
      lock_inode: request.lockInode,
      truth: {
        marker_present_at_install: true,
        lock_held_at_install: true,
        marker_retirement_authorized: true,
        finalization_witness_required_before_lock_cleanup: true,
        marker_absence_claimed: false,
        lock_absence_claimed: false,
      },
    };
    exact(receipt, SUCCESS_RECEIPT_KEYS, "success_artifact_receipt");
    exact(
      receipt.truth,
      SUCCESS_RECEIPT_TRUTH_KEYS,
      "success_artifact_receipt",
    );
    const receiptBytesUTF8 = `${JSON.stringify(receipt, null, 2)}\n`;
    const bundle: SuccessArtifactBundle = {
      authorityProjection: structuredClone(authority),
      authorityProjectionSHA256: authoritySHA256,
      markerBytesUTF8: request.markerBytesUTF8,
      markerSHA256,
      witness,
      witnessBytesUTF8,
      witnessSHA256,
      receipt,
      receiptBytesUTF8,
      receiptSHA256: digest(receiptBytesUTF8),
    };
    validateSuccessArtifactBundle(bundle);
    return immutable(bundle);
  };
  const validateSuccessArtifactBundle = (
    rawBundle: SuccessArtifactBundle,
  ): void => {
    const code = "success_artifact_bundle";
    const bundle = exact(rawBundle, SUCCESS_ARTIFACT_BUNDLE_KEYS, code);
    const authority = exact(
      bundle.authorityProjection,
      SUCCESS_AUTHORITY_KEYS,
      code,
    );
    const witness = exact(bundle.witness, SUCCESS_WITNESS_KEYS, code);
    const receipt = exact(bundle.receipt, SUCCESS_RECEIPT_KEYS, code);
    const witnessTruth = exact(
      witness.truth,
      SUCCESS_WITNESS_TRUTH_KEYS,
      code,
    );
    const receiptTruth = exact(
      receipt.truth,
      SUCCESS_RECEIPT_TRUTH_KEYS,
      code,
    );
    require(
      typeof bundle.markerBytesUTF8 === "string" &&
        typeof bundle.witnessBytesUTF8 === "string" &&
        typeof bundle.receiptBytesUTF8 === "string" &&
        validSHA(bundle.authorityProjectionSHA256) &&
        validSHA(bundle.markerSHA256) && validSHA(bundle.witnessSHA256) &&
        validSHA(bundle.receiptSHA256) &&
        digest(canonical(authority)) === bundle.authorityProjectionSHA256 &&
        digest(bundle.markerBytesUTF8) === bundle.markerSHA256 &&
        digest(bundle.witnessBytesUTF8) === bundle.witnessSHA256 &&
        digest(bundle.receiptBytesUTF8) === bundle.receiptSHA256 &&
        bundle.witnessBytesUTF8 === `${canonical(witness)}\n` &&
        bundle.receiptBytesUTF8 === `${JSON.stringify(receipt, null, 2)}\n`,
      code,
    );
    let markerValue: unknown;
    try {
      markerValue = JSON.parse(bundle.markerBytesUTF8);
    } catch {
      return refuse(code);
    }
    const marker = requireBridgeMarkerShape(markerValue, code);
    const markerFinalization = exact(
      marker.success_finalization,
      BRIDGE_SUCCESS_FINALIZATION_KEYS,
      code,
    );
    const markerReceipt = exact(
      marker.success_receipt,
      BRIDGE_SUCCESS_RECEIPT_KEYS,
      code,
    );
    require(
      bundle.markerBytesUTF8 === `${canonical(marker)}\n` &&
        marker.status === "success_proven_receipt_pending" &&
        marker.checkpoint === "success_proven_receipt_pending" &&
        marker.recovery_required === false &&
        marker.manual_finalization_required === true &&
        marker.failure_code === null &&
        marker.updated_at === authority.success_proven_at &&
        markerFinalization.schema ===
          "agenttool-phase-b-refence-maintenance-success-finalization/v1" &&
        markerFinalization.authority_projection_sha256 ===
          bundle.authorityProjectionSHA256 &&
        markerFinalization.receipt_pending === true &&
        markerFinalization.marker_retirement_authorized === true &&
        markerReceipt.sha256 === null && markerReceipt.durable === false &&
        digest(canonical(bridgeMarkerSuccessAuthorityProjection(marker))) ===
          authority.marker_authority_sha256 &&
        marker.controller_run_id === authority.controller_run_id &&
        marker.rollout_id === authority.rollout_id &&
        marker.source_revision === authority.source_revision &&
        marker.source_tree === authority.source_tree &&
        digest(canonical(marker.database_convergence)) ===
          authority.database_convergence_sha256 &&
        marker.deploy_lock.sha256 === authority.deploy_lock_sha256 &&
        digest(canonical(marker.build_context)) ===
          authority.build_context_sha256 &&
        digest(canonical(marker.dependency_estate)) ===
          authority.dependency_estate_sha256 &&
        digest(canonical(marker.refence_handoff)) ===
          authority.refence_handoff_sha256 &&
        canonical(markerWalAuthorityProjection(marker.child_wal, code)) ===
          canonical(authority.controller_wal),
      code,
    );
    const rolloutProofs = exact(
      authority.rollout_proofs,
      SUCCESS_ROLLOUT_PROOF_KEYS,
      code,
    );
    const finalTruth = exact(
      authority.final_truth,
      SUCCESS_FINAL_TRUTH_KEYS,
      code,
    );
    const markerRoles = exact(marker.role_mapping, BRIDGE_ROLE_KEYS, code);
    const markerApplications = row(markerRoles, code).app_machine_ids;
    const rawEffects = rolloutProofs.fly_effects;
    require(
      Array.isArray(markerApplications) && markerApplications.length === 3 &&
        markerApplications.every(validID) && Array.isArray(rawEffects) &&
        rawEffects.length === 28 &&
        validID(markerRoles.thinker_primary_machine_id) &&
        validID(markerRoles.thinker_standby_machine_id),
      code,
    );
    const applicationOrder = rawEffects.slice(2, 5).map((raw: unknown) =>
      exact(raw, ["operation", "target", "proof_sha256"], code).target
    );
    require(
      applicationOrder.every(validID) && new Set(applicationOrder).size === 3 &&
        canonical([...applicationOrder].sort()) ===
          canonical([...markerApplications].sort()),
      code,
    );
    const expectedEffects = [
      ["build_push", "agenttool"],
      ["update_image", markerRoles.thinker_primary_machine_id],
      ...[...applicationOrder, markerRoles.thinker_standby_machine_id].map((
        id,
      ) => ["update_image", id]),
      ...applicationOrder.map((id: string) => ["restore_app", id]),
      ["restore_primary", markerRoles.thinker_primary_machine_id],
      ["restore_standby", markerRoles.thinker_standby_machine_id],
      ...applicationOrder.flatMap((id: string) => [["start", id], [
        "wait_started",
        id,
      ]]),
      ...applicationOrder.flatMap((id: string) => [["enable_autostart", id], [
        "wait_started",
        id,
      ]]),
      ["start", markerRoles.thinker_primary_machine_id],
      ["wait_started", markerRoles.thinker_primary_machine_id],
      ...applicationOrder.map((id: string) => ["uncordon", id]),
    ];
    require(
      canonical(rawEffects.map((raw: unknown) => {
            const effect = exact(
              raw,
              ["operation", "target", "proof_sha256"],
              code,
            );
            require(validSHA(effect.proof_sha256), code);
            return [effect.operation, effect.target];
          })) === canonical(expectedEffects) &&
        canonical(rolloutProofs.special_guards) === canonical([
            marker.guard_proofs.prepublication_before_build_sha256,
            marker.guard_proofs.prepublication_before_image_sha256,
          ]) &&
        rolloutProofs.public_first_canary_sha256 ===
          marker.public_proofs.first_canary_sha256 &&
        rolloutProofs.public_final_sha256 ===
          marker.public_proofs.final_sha256 &&
        rolloutProofs.final_authority_sha256 ===
          marker.guard_proofs.final_sha256 &&
        rolloutProofs.ordinary_absent_postflight_sha256 ===
          marker.public_proofs.ordinary_postflight_sha256 &&
        finalTruth.schema ===
          "agenttool-phase-b-refence-maintenance-final-truth/v1" &&
        finalTruth.database_convergence_verified === true &&
        finalTruth.target_image_machine_count === 5 &&
        finalTruth.started_service_machine_count === 4 &&
        finalTruth.autostart_enabled_app_count === 3 &&
        finalTruth.uncordoned_app_count === 3 &&
        finalTruth.standby_stopped === true &&
        finalTruth.authority_state === "absent_fail_closed" &&
        finalTruth.ordinary_absent_postflight_verified === true &&
        finalTruth.controller_wal_sealed === true &&
        finalTruth.active_child_count === 0 &&
        finalTruth.effects_closed === true &&
        finalTruth.migration_attempt_count === 0 &&
        finalTruth.database_write_attempt_count === 1 &&
        finalTruth.rollback_attempt_count === 0,
      code,
    );
    const stateRoot = "/Users/yournameisai/.local/state/agenttool";
    const stateDirectory = `${stateRoot}/deploy-state`;
    const receiptDirectory = `${stateRoot}/deploy-receipts`;
    const runID = authority.controller_run_id;
    const artifactPaths = [
      witness.marker_path,
      witness.marker_retirement_claim_path,
      witness.receipt_path,
      receipt.witness_path,
      witness.lock_public_path,
      witness.lock_owner_path,
    ];
    require(
      artifactPaths.every((path) => typeof path === "string") &&
        new Set(artifactPaths).size === artifactPaths.length &&
        witness.marker_path === `${stateDirectory}/maintenance-active.json` &&
        witness.marker_retirement_claim_path ===
          `${stateDirectory}/.phase-b-refence-maintenance-marker-retirement-${runID}.claim` &&
        receipt.witness_path ===
          `${stateDirectory}/phase-b-refence-maintenance-finalization-${runID}.json` &&
        witness.receipt_path.startsWith(`${receiptDirectory}/`) &&
        /^20[0-9]{6}T[0-9]{6}Z-[0-9a-f]{12}-[1-9][0-9]*\.json$/
          .test(witness.receipt_path.slice(receiptDirectory.length + 1)) &&
        witness.receipt_path.slice(
            receiptDirectory.length + 18,
            receiptDirectory.length + 30,
          ) === authority.source_revision.slice(0, 12) &&
        witness.lock_public_path === `${stateRoot}/deploy.lock` &&
        witness.lock_owner_path.startsWith(`${stateRoot}/`) &&
        /^\.deploy-lock-owner\.refence-[1-9][0-9]*-[0-9a-f]{16}$/
          .test(witness.lock_owner_path.slice(stateRoot.length + 1)) &&
        witness.schema ===
          "agenttool-phase-b-refence-maintenance-finalization/v1" &&
        receipt.schema === "agenttool-deploy-receipt/v8" &&
        witness.run_id === authority.controller_run_id &&
        receipt.run_id === authority.controller_run_id &&
        witness.rollout_id === authority.rollout_id &&
        receipt.rollout_id === authority.rollout_id &&
        witness.source_revision === authority.source_revision &&
        receipt.source_revision === authority.source_revision &&
        witness.source_tree === authority.source_tree &&
        receipt.source_tree === authority.source_tree &&
        witness.success_proven_at === authority.success_proven_at &&
        receipt.success_proven_at === authority.success_proven_at &&
        canonical(witness.authority_projection) === canonical(authority) &&
        canonical(receipt.authority_projection) === canonical(authority) &&
        witness.authority_projection_sha256 ===
          bundle.authorityProjectionSHA256 &&
        receipt.authority_projection_sha256 ===
          bundle.authorityProjectionSHA256 &&
        witness.marker_bytes_utf8 === bundle.markerBytesUTF8 &&
        receipt.marker_bytes_utf8 === bundle.markerBytesUTF8 &&
        witness.marker_sha256 === bundle.markerSHA256 &&
        receipt.marker_sha256 === bundle.markerSHA256 &&
        receipt.witness_bytes_utf8 === bundle.witnessBytesUTF8 &&
        receipt.witness_sha256 === bundle.witnessSHA256 &&
        markerFinalization.witness_path === receipt.witness_path &&
        markerFinalization.marker_retirement_claim_path ===
          witness.marker_retirement_claim_path &&
        markerReceipt.path === witness.receipt_path &&
        witness.marker_path === receipt.marker_path &&
        witness.marker_path.endsWith("/maintenance-active.json") &&
        witness.lock_public_path === marker.deploy_lock.public_path &&
        witness.lock_owner_path === marker.deploy_lock.owner_record &&
        witness.lock_device === String(marker.deploy_lock.device) &&
        witness.lock_inode === String(marker.deploy_lock.inode) &&
        witness.lock_sha256 === marker.deploy_lock.sha256 &&
        receipt.lock_device === witness.lock_device &&
        receipt.lock_inode === witness.lock_inode &&
        witnessTruth.receipt_exact_and_durable === true &&
        witnessTruth.marker_canonical_absent_and_directory_fsynced === true &&
        witnessTruth.marker_retirement_claim_retained_at_install === true &&
        witnessTruth.same_original_lock_inode_held === true &&
        witnessTruth.lock_cleanup_authorized === true &&
        witnessTruth.lock_absence_claimed === false &&
        receiptTruth.marker_present_at_install === true &&
        receiptTruth.lock_held_at_install === true &&
        receiptTruth.marker_retirement_authorized === true &&
        receiptTruth.finalization_witness_required_before_lock_cleanup ===
          true &&
        receiptTruth.marker_absence_claimed === false &&
        receiptTruth.lock_absence_claimed === false,
      code,
    );
    const preFinalizationMarker = structuredClone(marker);
    preFinalizationMarker.status = "active";
    preFinalizationMarker.checkpoint = "all_final_gates_verified";
    preFinalizationMarker.recovery_required = true;
    preFinalizationMarker.manual_finalization_required = false;
    preFinalizationMarker.success_receipt = {
      path: null,
      sha256: null,
      durable: false,
    };
    preFinalizationMarker.success_finalization = {
      schema: "agenttool-phase-b-refence-maintenance-success-finalization/v1",
      authority_projection_sha256: null,
      witness_path: null,
      marker_retirement_claim_path: null,
      receipt_pending: false,
      marker_retirement_authorized: false,
    };
    const [appLHR0, appLHR1, appCDG] = applicationOrder as [
      string,
      string,
      string,
    ];
    const reconstructed = createSuccessAuthorityProjection({
      successProvenAt: authority.success_proven_at as string,
      controllerRunID: authority.controller_run_id as string,
      rolloutID: authority.rollout_id as string,
      refenceReceiptSHA256: authority.refence_receipt_sha256 as string,
      sourceRevision: authority.source_revision as string,
      sourceTree: authority.source_tree as string,
      roles: {
        app_lhr: [appLHR0, appLHR1],
        app_cdg: appCDG,
        thinker_primary: markerRoles.thinker_primary_machine_id as string,
        thinker_standby: markerRoles.thinker_standby_machine_id as string,
      },
      marker: preFinalizationMarker,
      databaseConvergence: marker.database_convergence as Row,
      deployLock: marker.deploy_lock as Row,
      deployLockSHA256: authority.deploy_lock_sha256 as string,
      earlyGuardSHA256: row(marker.guard_proofs, code).early_sha256 as string,
      buildContext: marker.build_context as Row,
      dependencyEstate: marker.dependency_estate as Row,
      refenceHandoff: marker.refence_handoff as Row,
      retainedArchives: authority
        .retained_archives as SuccessAuthorityProjection[
          "retained_archives"
        ],
      controllerWal: authority.controller_wal as Row,
      rolloutProofs: authority.rollout_proofs as Row,
      finalTruth: authority.final_truth as Row,
    });
    const expectedA0Marker = previewSuccessFinalizationMarker({
      currentMarker: preFinalizationMarker,
      successProvenAt: authority.success_proven_at as string,
      walProjection: authority.controller_wal as Row,
      authorityProjectionSHA256: bundle.authorityProjectionSHA256 as string,
      receiptPath: witness.receipt_path as string,
      witnessPath: receipt.witness_path as string,
      markerRetirementClaimPath: witness.marker_retirement_claim_path as string,
    });
    require(
      canonical(reconstructed) === canonical(authority) &&
        canonical(expectedA0Marker) === canonical(marker),
      code,
    );
  };
  return Object.freeze({
    schema: CONTRACT_SCHEMA,
    expectedAuditWitness,
    normalizedFullAudit,
    normalizedRefenceOperator,
    refenceOperatorDeclarationValues,
    refenceOperatorImmutableCaveats,
    validateFlyAuthenticationConfigText,
    controllerFlyArgv,
    controllerOperationContract,
    parseFleetChildOutput,
    expectedOrdinaryAbsentPostflightBytes,
    parsePublicObservation,
    databaseOriginContract: DATABASE_ORIGIN_TRANSACTION_CONTRACT,
    maintenanceDatabaseProofSQL: MAINTENANCE_DATABASE_PROOF_SQL,
    producerCriticalContractSHA256,
    producerLocalStateSandwichSHA256,
    validateControllerWalEntry,
    validateDatabaseConvergenceInheritedProof,
    validateDatabaseConvergenceMarker,
    validateDatabaseConvergenceTransition,
    validateFinalAuthority,
    validateDatabaseOriginConvergence,
    validateDatabaseProof,
    validateStoppedFleet,
    validateTargetFleet,
    validateTargetFleetExpectation: requireExpectation,
    validateFleetTransition,
    validateFirstCanaryPublic,
    runFirstCanaryPublicCore,
    runFinalAuthorityCore,
    runStoppedFenceCore,
    runCordonedRuntimeCore,
    validatePublicFederationAbout,
    validatePublicHealth,
    validateVerifiedDatabaseConvergence,
    bridgeMarkerSuccessAuthorityProjection,
    validateBridgeMarkerTransition,
    validateProducerAuthorityProjection,
    validateProducerEarlyRuntimeBindings,
    validateProducerLocalStateSandwich,
    applyRecoveryMarkerTransition,
    createSuccessAuthorityProjection,
    createSuccessArtifacts,
    previewSuccessFinalizationMarker,
    validateSuccessArtifactBundle,
  });
}
