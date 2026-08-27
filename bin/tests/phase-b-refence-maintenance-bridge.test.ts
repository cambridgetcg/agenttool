import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmodSync,
  chownSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { createServer, type Socket as NetSocket } from "node:net";
import { basename, dirname, join } from "node:path";
import {
  CONTRACT_SCHEMA,
  createMaintenanceContract,
} from "../phase-b-refence-maintenance-contract.ts";
import {
  BRIDGE_PACK_DIRECTIVE,
  BRIDGE_PACK_MAX_LINE_ENTRIES,
  maintenanceBridgePackFacts,
  packMaintenanceBridgeSource,
} from "./phase-b-refence-maintenance-line-pack.ts";
import {
  acquireDeployLockForController,
  appendControllerTransitionVerification,
  appendDatabaseConvergenceCommitForTest,
  appendDatabaseConvergenceIntentForTest,
  appendDatabaseConvergenceVerifiedForTest,
  applyRecoveryMarkerTransitionForTest,
  canonicalJson,
  classifyFlySSHAgentPSForTest,
  closeRetainedDeployLockDescriptorForTest,
  connectFlySSHAgentProtocolForContainedTest,
  controllerFlyArgv,
  type ControllerFlyEffectRuntime,
  type ControllerFlyOperation,
  ControllerManualInterventionError,
  controllerPublicHTTPArgvForTest,
  controllerRuntimeFlyArgvForTest,
  controllerRuntimeRemoteCommandForTest,
  ControllerSettledObservationError,
  ControllerWalWriter,
  createDatabaseClientRegistryForTest,
  createProductionChildPipeOwnerForTest,
  createSessionResourceTeardownForTest,
  createSuccessArtifactsForTest,
  createSuccessAuthorityProjectionForTest,
  createSuccessReadyBridgeMarkerForTest,
  DatabaseConvergenceAcknowledgedError,
  type DatabaseOriginConvergenceProof,
  databaseOriginStatementSHA256ForTest,
  type DatabaseProof,
  type DeployLockAuthority,
  type DurableFileIdentity,
  executeControllerEffect,
  executeControllerEffectToSettlement,
  expectedAuditWitness,
  expectedOrdinaryAbsentPostflightBytes,
  flySSHAgentHolderPIDsForTest,
  type HandoffCeremonyPaths,
  type HandoffCrashPoint,
  type HandoffEdge,
  loadMaintenanceContractForContainedTest,
  MAINTENANCE_MARKER_SCHEMA,
  MAINTENANCE_REFENCE_PROOF_SCHEMA,
  type MaintenanceRefenceDependencies,
  MaintenanceRefenceError,
  normalizedBridgeSource,
  normalizedFullAudit,
  normalizedRefenceOperator,
  OPERATOR_NORMALIZATION_CONTRACT,
  parseArguments,
  parseControllerPublicObservationForTest,
  parseGitTreeFiles,
  parsePrivateJsonDocumentForTest,
  parseImmediateFailedCompatibilityParentsForTest,
  parseImmediateProtectedSuccessorChangedPathsForTest,
  parsePriorFailedCompatibilityParentsForTest,
  parsePriorProtectedSuccessorChangedPathsForTest,
  parseProtectedSuccessorChangedPathsForTest,
  parseProtectedSuccessorParentsForTest,
  performControllerFlyTransitionForTest,
  performControllerJournalledProviderReadForTest,
  performControllerJournalledReadChildForTest,
  performHandoffCeremony,
  performSuccessFinalizationCeremony,
  previewSuccessFinalizationMarkerForTest,
  ProductionFlySSHAgentLifecycle,
  producerCriticalContractSHA256ForTest,
  producerLocalStateSandwichSHA256ForTest,
  RECEIPT_KEYS,
  reconcileDurableCanonicalJsonTransitionForTest,
  refenceGitInvocationAllowedForTest,
  releaseDeployLockForController,
  releaseDeployLockPublicForController,
  replaceDurableCanonicalJsonCAS,
  requireAuthorizedH0ReceiptForTest,
  type RoleMap,
  runControllerCordonedRuntimeCoreForTest,
  runControllerDatabaseConvergenceCoreForTest,
  runControllerFinalAuthorityCoreForTest,
  runControllerFirstCanaryPublicCoreForTest,
  runControllerRecoveryCoreForTest,
  runControllerRecoveryDispatchCoreForTest,
  runControllerRolloutCore,
  runControllerStoppedFenceProofCoreForTest,
  runFlySSHAgentOwnedBatchForTest,
  runMaintenanceRefenceGuardCoreForTest,
  runOwnedControllerSessionForTest,
  settleResourceTwiceForTest,
  sha256,
  type SuccessFinalizationArtifacts,
  type SuccessFinalizationCrashPoint,
  type SuccessFinalizationOpenDescriptor,
  type SuccessFinalizationPaths,
  type TerminalEvidence,
  validateControllerFinalAuthorityForTest,
  validateControllerFirstCanaryPublicForTest,
  validateControllerFleetTransitionForTest,
  validateControllerPublicFederationAboutForTest,
  validateControllerPublicHealthForTest,
  validateCompatibilityControllerBindingsForTest,
  validateDatabaseConvergenceMarkerForTest,
  validateDatabaseConvergenceTransitionForTest,
  validateDatabaseOriginConvergenceForTest,
  validateFlyAuthenticationConfigText,
  validateGitLocalConfigForTest,
  validateMaintenanceContractBytesForTest,
  validateOrdinaryAbsentPostflightBytesForTest,
  validateProducerEarlyRuntimeBindingsForTest,
  validateProducerLocalStateSandwichForTest,
  validateProtectedSuccessorGitProofForTest,
  validateRawDeployReceiptForTest,
  validateRefenceReceiptWalAuthorityForTest,
  validateSuccessArtifactBundleForTest,
  validateTargetFleetForTest,
  validateVerifiedDatabaseConvergenceForTest,
  consumeFlySSHAgentLaunchAuthorityForTest,
  parseFlySSHAgentLSOFForTest,
  parseFlySSHAgentPSForTest,
  type FlySSHAgentIdentity,
  type FlySSHAgentObservation,
  type FlySSHAgentStopIntent,
  type FlySSHAgentStopReceipt,
} from "../phase-b-refence-maintenance-bridge.ts";

const temporaryDirectories: string[] = [];

const CONTRACT_PATH = join(
  import.meta.dir,
  "..",
  "phase-b-refence-maintenance-contract.ts",
);

function containedContractBytes() {
  const bytes = readFileSync(CONTRACT_PATH);
  return {
    bytes,
    sha256: sha256(bytes),
    gitBlobSHA1: createHash("sha1")
      .update(`blob ${bytes.byteLength}\0`)
      .update(bytes)
      .digest("hex"),
  };
}

beforeAll(async () => {
  await loadMaintenanceContractForContainedTest(containedContractBytes());
});

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const digest = (character: string) => character.repeat(64);
const revision = (character: string) => character.repeat(40);
const AUTHORIZED_H0_RECEIPT_SHA256 =
  "8b5bb36641fb210ee9ecb542d5adb3cfcb99adb76af369715aa32805e3e18077";
const AUTHORIZED_H0_RUN_ID = "789e8486-47cb-4b80-a165-c5ea557082d6";
const AUTHORIZED_H0_TARGET_REVISION =
  "d87a3f35c80bdac39402e1c34dfebe643a18beb6";
const AUTHORIZED_H0_TARGET_TREE =
  "0b5881546a39e328b8299cf9bbfde8d25b15580b";
const AUTHORIZED_H0_GUARD_RAW_SHA256 =
  "dd324e32fada2053acc945d39012d5844caef402ad82f013b27b18d3ddb275ae";
const AUTHORIZED_H0_GUARD_NORMALIZED_SHA256 =
  "9e0ddd120fa6d605f68a86be35303a1b2eba56155116218933f8801eda47340c";
const AUTHORIZED_H0_CONTRACT_RAW_SHA256 =
  "0c7ad30f81271b42a2339fcf1f87705c1ff6ee4a5906506f8a2c089ab92e74a1";
const AUTHORIZED_H0_CONTRACT_GIT_BLOB =
  "ea83765c054b3bf130a4c8957a5a30ef1e657cb6";
const PRIOR_FAILED_COMPATIBILITY_REVISION =
  "e4b9ed4188ad1f01cfaa6bb5385d21d53625fa73";
const PRIOR_FAILED_COMPATIBILITY_TREE =
  "87face598df18f71ecda4997a82e0f49934b8166";
const PRIOR_FAILED_COMPATIBILITY_TOPIC_REVISION =
  "8e644fb52da22badcd6da6cd2324291e1d37f656";
const PRIOR_FAILED_COMPATIBILITY_COMMIT_RAW_SHA256 =
  "399dccbf17db1805f48e10d77068bb5130fc5fb03b12094445942fe01980a891";
const IMMEDIATE_FAILED_COMPATIBILITY_REVISION =
  "56dcf1bf5029bd8416a915e65e0e7c1416eea099";
const IMMEDIATE_FAILED_COMPATIBILITY_TREE =
  "2f0a48ad44d8734edf954e1bd031a032cd390373";
const IMMEDIATE_FAILED_COMPATIBILITY_TOPIC_REVISION =
  "d33d35c4b757bdd8ee10b568a6d0a6caea8e80d8";
const IMMEDIATE_FAILED_COMPATIBILITY_COMMIT_RAW_SHA256 =
  "bad2d53cb767c326b27bf6ccbe4fd0f447ff19da6165b5fb7cba2f66c7b1b041";
const IMMEDIATE_FAILED_DOWNSTREAM_EFFECTS = {
  git_fetch_attempt_count: 0,
  controller_wal_entry_count: 0,
  handoff_transition_count: 0,
  build_context_create_count: 0,
  dependency_estate_create_count: 0,
  network_attempt_count: 0,
  provider_effect_count: 0,
  fleet_effect_count: 0,
  database_write_attempt_count: 0,
  keychain_write_attempt_count: 0,
} as const;
const PRIOR_PROTECTED_SUCCESSOR_CHANGED_PATH_STATUSES = [
  { old_mode: "100755", new_mode: "100755", status: "M", path: "bin/deploy.sh" },
  { old_mode: "100644", new_mode: "100644", status: "M", path: "bin/phase-b-refence-maintenance-bridge.ts" },
  { old_mode: "100644", new_mode: "100644", status: "M", path: "bin/phase-b-refence-maintenance-contract.ts" },
  { old_mode: "100644", new_mode: "100644", status: "M", path: "bin/tests/phase-b-refence-maintenance-bridge.test.ts" },
  { old_mode: "100644", new_mode: "100644", status: "M", path: "bin/tests/phase-b-refence-maintenance-dispatcher.test.ts" },
  { old_mode: "100644", new_mode: "100644", status: "M", path: "packages/constructive-intelligence/tests/concurrency.test.ts" },
] as const;
const PROTECTED_SUCCESSOR_CHANGED_PATH_STATUSES = PRIOR_PROTECTED_SUCCESSOR_CHANGED_PATH_STATUSES.slice(0, 5);

function protectedSuccessorGitProof(evidence: TerminalEvidence) {
  const contract = containedContractBytes();
  return {
    revision: revision("e"),
    tree: revision("f"),
    source_distance: 54,
    commit_raw_sha256: digest("c"),
    commit_byte_count: 1_300,
    first_parent_revision: IMMEDIATE_FAILED_COMPATIBILITY_REVISION,
    second_parent_revision: revision("1"),
    second_parent_tree: revision("f"),
    changed_paths_raw_sha256: sha256("current repair raw diff"),
    changed_path_statuses: structuredClone(PROTECTED_SUCCESSOR_CHANGED_PATH_STATUSES),
    cumulative_changed_paths_raw_sha256: sha256("current cumulative raw diff"),
    cumulative_changed_path_statuses: structuredClone(PRIOR_PROTECTED_SUCCESSOR_CHANGED_PATH_STATUSES),
    prior_failed_compatibility_controller: {
      revision: PRIOR_FAILED_COMPATIBILITY_REVISION,
      tree: PRIOR_FAILED_COMPATIBILITY_TREE,
      source_distance: 51,
      commit_raw_sha256: PRIOR_FAILED_COMPATIBILITY_COMMIT_RAW_SHA256,
      commit_byte_count: 1_246,
      first_parent_revision: AUTHORIZED_H0_TARGET_REVISION,
      second_parent_revision: PRIOR_FAILED_COMPATIBILITY_TOPIC_REVISION,
      second_parent_tree: PRIOR_FAILED_COMPATIBILITY_TREE,
      changed_paths_raw_sha256:
        "a66803eadc08fb8deb23fe3076deeadfc5310c1c6b5aeb50f5edc284511aaf28",
      changed_path_statuses: structuredClone(PRIOR_PROTECTED_SUCCESSOR_CHANGED_PATH_STATUSES),
      bridge_source_sha256:
        "6be6664c2dee86ac427dda893a7f2aa51ee639951e00a6e802c60f98fa153f5c",
      bridge_normalized_sha256:
        "539b4711da2628946a6592944ab0ea9da40db711accdbe412520267540c41c8e",
      contract_source_sha256:
        "e1b05bcdaa7e7775cb7156660e87d65a0e9bba0a54b8cb1f0cc062f1b14aea14",
      contract_git_blob: "c543e1e79f1efd1d24fbf2de539884b0f44b4e9a",
      lifecycle: "failed_pre_h",
      static_refusal_barrier: "raw_commit_terminal_lf_required",
      static_refusal_barrier_verified: true,
      observed_first_refusal_predicate: false,
      controller_success: false,
      mutation_effect_began: false,
      success_authority: false,
      effect_authority: false,
    },
    immediate_failed_compatibility_controller: {
      revision: IMMEDIATE_FAILED_COMPATIBILITY_REVISION,
      tree: IMMEDIATE_FAILED_COMPATIBILITY_TREE,
      source_distance: 53,
      commit_raw_sha256: IMMEDIATE_FAILED_COMPATIBILITY_COMMIT_RAW_SHA256,
      commit_byte_count: 1_251,
      first_parent_revision: PRIOR_FAILED_COMPATIBILITY_REVISION,
      second_parent_revision: IMMEDIATE_FAILED_COMPATIBILITY_TOPIC_REVISION,
      second_parent_tree: IMMEDIATE_FAILED_COMPATIBILITY_TREE,
      changed_paths_raw_sha256:
        "ea34fd5818a88c0554303040c9472d7b3699db15bbae5344c4b1e670577bc6f8",
      changed_path_statuses: structuredClone(PROTECTED_SUCCESSOR_CHANGED_PATH_STATUSES),
      cumulative_changed_paths_raw_sha256:
        "8d83631671ddfab6bc122d5b571df49ab0907c2e40ac1353f2663ccae407d7c2",
      cumulative_changed_path_statuses: structuredClone(PRIOR_PROTECTED_SUCCESSOR_CHANGED_PATH_STATUSES),
      bridge_source_sha256:
        "5ebe56c754c39a12bf851b967acbbc31ca5dfa644d15e736c736353c9636ef54",
      bridge_normalized_sha256:
        "e4c7a8ace65d84a3715182cb96d735747cadaf076e55efbbdde7c2f2bb1c5f2d",
      contract_source_sha256:
        "40136b456704debe4fa253745d83441c9ddb099d90b47a10aa27837c7a027a97",
      contract_git_blob: "79efd55c97a8e5e2fc6f2da1317ee73b95293b1c",
      lifecycle: "failed_pre_h",
      refusal_predicate: "process_census",
      observed_first_refusal_predicate: true,
      controller_exit_code: 74,
      stderr_sha256:
        "60298dba6e24230d90d2f8ae15f3319f284b498cd3f14dbdbbedb8f1689322d8",
      stderr_byte_count: 35,
      retained_deploy_lock_sha256:
        "63b41175b9b17ddb000c815a477ca357ee923d9c18eabec7b339ba3f5f1288cf",
      controller_success: false,
      mutation_effect_began: false,
      success_authority: false,
      effect_authority: false,
      downstream_effects: structuredClone(IMMEDIATE_FAILED_DOWNSTREAM_EFFECTS),
    },
    authorized_h0_guard_raw_sha256: AUTHORIZED_H0_GUARD_RAW_SHA256,
    authorized_h0_guard_normalized_sha256: AUTHORIZED_H0_GUARD_NORMALIZED_SHA256,
    authorized_h0_contract_source_sha256: AUTHORIZED_H0_CONTRACT_RAW_SHA256,
    authorized_h0_contract_git_blob: AUTHORIZED_H0_CONTRACT_GIT_BLOB,
    bridge_source_sha256: evidence.bridgeRawSHA256,
    bridge_normalized_sha256: evidence.bridgeNormalizedSHA256,
    contract_source_sha256: contract.sha256,
    contract_git_blob: contract.gitBlobSHA1,
    protected_head: true as const,
    clean: true as const,
  };
}

const HANDSHAKE_FIXTURE = join(
  import.meta.dir,
  "fixtures/phase-b-refence-maintenance-handshake-v1.json",
);
const PRODUCTION_SHAPE_FIXTURE = join(
  import.meta.dir,
  "fixtures/phase-b-refence-maintenance-production-shape-v1.json",
);

function fixtureRequire(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(`fixture_${label}`);
}

function expectMaintenanceRefusalCode(
  operation: () => unknown,
  code: string,
): void {
  try {
    operation();
    throw new Error("expected maintenance refusal");
  } catch (error) {
    expect(error).toBeInstanceOf(MaintenanceRefenceError);
    expect((error as MaintenanceRefenceError).code).toBe(code);
  }
}

function fixtureExactKeys(
  value: unknown,
  expected: readonly string[],
  label: string,
): asserts value is Record<string, any> {
  fixtureRequire(
    value !== null && typeof value === "object" && !Array.isArray(value),
    label,
  );
  const actual = Object.keys(value as object).sort();
  const wanted = [...expected].sort();
  fixtureRequire(
    actual.length === wanted.length &&
      actual.every((key, index) => key === wanted[index]),
    label,
  );
}

function bytewiseSorted(values: readonly string[]): string[] {
  return [...values].sort((left, right) =>
    Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"))
  );
}

function validateHandshakeFixtureBytes(bytes: string): Record<string, any> {
  fixtureRequire(bytes.endsWith("\n"), "outer_lf");
  const fixture = JSON.parse(bytes);
  fixtureExactKeys(
    fixture,
    [
      "schema",
      "fixture_id",
      "synthetic_only",
      "directories",
      "operator_source_file",
      "operator_harness_file",
      "audit_source_file",
      "audit_harness_file",
      "audit_witness_file",
      "bridge_source_file",
      "receipt_file",
      "wal_files",
      "anchor_file",
      "armed_witness_file",
      "expected_h0_layout",
    ],
    "outer_shape",
  );
  fixtureRequire(
    bytes === `${canonicalJson(fixture)}\n` &&
      fixture.schema ===
        "agenttool-phase-b-refence-maintenance-handshake-fixture/v1" &&
      fixture.fixture_id === "deterministic-handshake-001" &&
      fixture.synthetic_only === true,
    "outer_canonical",
  );

  const fileKeys = [
    "operator_source_file",
    "operator_harness_file",
    "audit_source_file",
    "audit_harness_file",
    "audit_witness_file",
    "bridge_source_file",
    "receipt_file",
    "anchor_file",
    "armed_witness_file",
  ] as const;
  const allFiles = [
    ...fileKeys.map((key) => fixture[key]),
    ...fixture.wal_files,
  ] as Array<Record<string, any>>;
  fixtureRequire(allFiles.length === 13, "file_count");
  const paths = new Set<string>();
  for (const file of allFiles) {
    fixtureExactKeys(
      file,
      ["bytes_utf8", "metadata", "path", "sha256"],
      "file_shape",
    );
    fixtureExactKeys(
      file.metadata,
      ["gid", "mode", "nlink", "type", "uid"],
      "file_meta",
    );
    fixtureRequire(
      typeof file.path === "string" &&
        file.path.startsWith("/Users/yournameisai/") &&
        typeof file.bytes_utf8 === "string" && file.bytes_utf8.length > 0 &&
        sha256(file.bytes_utf8) === file.sha256 &&
        /^[0-9a-f]{64}$/.test(file.sha256) &&
        file.metadata.type === "file" && file.metadata.uid === 501 &&
        file.metadata.gid === 20 && file.metadata.nlink === 1 &&
        file.metadata.mode ===
          (file === fixture.bridge_source_file ? 0o644 : 0o600) &&
        !paths.has(file.path),
      "file_contract",
    );
    paths.add(file.path);
  }

  fixtureRequire(
    Array.isArray(fixture.directories) && fixture.directories.length === 5,
    "dirs",
  );
  const directoryPaths = fixture.directories.map((entry: Record<string, any>) =>
    entry.path
  );
  fixtureRequire(
    canonicalJson(directoryPaths) ===
        canonicalJson(bytewiseSorted(directoryPaths)) &&
      new Set(directoryPaths).size === directoryPaths.length,
    "dir_order",
  );
  for (const directory of fixture.directories) {
    fixtureExactKeys(directory, ["entries", "metadata", "path"], "dir_shape");
    fixtureExactKeys(directory.metadata, [
      "gid",
      "mode",
      "nlink",
      "type",
      "uid",
    ], "dir_meta");
    fixtureRequire(
      directory.metadata.type === "directory" &&
        directory.metadata.uid === 501 &&
        directory.metadata.gid === 20 && directory.metadata.mode === 0o700 &&
        directory.metadata.nlink === 2 && Array.isArray(directory.entries) &&
        canonicalJson(directory.entries) ===
          canonicalJson(bytewiseSorted(directory.entries)) &&
        new Set(directory.entries).size === directory.entries.length,
      "dir_contract",
    );
    const expectedChildren = bytewiseSorted(
      [
        ...allFiles.map((file) => file.path),
        ...directoryPaths,
      ].filter((path) =>
        path !== directory.path && dirname(path) === directory.path
      )
        .map((path) => basename(path)),
    );
    fixtureRequire(
      canonicalJson(directory.entries) === canonicalJson(expectedChildren),
      "dir_inventory",
    );
  }

  const parseCanonicalDocument = (file: Record<string, any>, label: string) => {
    fixtureRequire(file.bytes_utf8.endsWith("\n"), `${label}_lf`);
    const value = JSON.parse(file.bytes_utf8);
    fixtureRequire(
      file.bytes_utf8 === `${canonicalJson(value)}\n`,
      `${label}_canonical`,
    );
    return value as Record<string, any>;
  };
  const receipt = parseCanonicalDocument(fixture.receipt_file, "receipt");
  const anchor = parseCanonicalDocument(fixture.anchor_file, "anchor");
  const armedWitness = parseCanonicalDocument(
    fixture.armed_witness_file,
    "armed_witness",
  );
  const auditWitness = parseCanonicalDocument(
    fixture.audit_witness_file,
    "audit_witness",
  );
  const walDocuments = fixture.wal_files.map((
    file: Record<string, any>,
    index: number,
  ) => parseCanonicalDocument(file, `wal_${index + 1}`));
  fixtureExactKeys(receipt, RECEIPT_KEYS, "receipt_shape");
  fixtureRequire(
    sha256(canonicalJson(receipt.caveats)) ===
      "60065bd2ec925ccbd7db5739700fc251d3c9d106fc4468c105423578c8d505db",
    "producer_caveats_source_projection",
  );

  const operatorProjection = parseCanonicalDocument(
    fixture.operator_source_file,
    "operator_source_projection",
  );
  const operatorHarnessProjection = parseCanonicalDocument(
    fixture.operator_harness_file,
    "operator_harness_projection",
  );
  const auditSourceProjection = parseCanonicalDocument(
    fixture.audit_source_file,
    "audit_source_projection",
  );
  const auditHarnessProjection = parseCanonicalDocument(
    fixture.audit_harness_file,
    "audit_harness_projection",
  );
  const bridgeSourceProjection = parseCanonicalDocument(
    fixture.bridge_source_file,
    "bridge_source_projection",
  );
  fixtureRequire(
    sha256(fixture.operator_source_file.bytes_utf8) ===
        receipt.operator_sha256 &&
      operatorProjection.semantic_sha256 ===
        receipt.operator_normalized_sha256 &&
      receipt.operator_normalized_sha256 ===
        "130fd8dce4d9c6e4aaf44d6870aae1da255c8502eb4f3f6c92dc4a71e95e2181" &&
      sha256(fixture.operator_harness_file.bytes_utf8) ===
        receipt.operator_harness_sha256 &&
      operatorHarnessProjection.contained_only === true &&
      canonicalJson(receipt.operator_normalization_contract) ===
        canonicalJson(OPERATOR_NORMALIZATION_CONTRACT),
    "operator_binding",
  );
  fixtureExactKeys(
    operatorProjection,
    ["declarations", "kind", "path", "schema", "semantic_sha256"],
    "operator_projection_shape",
  );
  fixtureRequire(
    operatorProjection.schema ===
        "agenttool-phase-b-refence-maintenance-handshake-source-projection/v1" &&
      operatorProjection.kind === "operator_source" &&
      operatorProjection.path === fixture.operator_source_file.path,
    "operator_projection_identity",
  );
  fixtureExactKeys(
    operatorProjection.declarations,
    OPERATOR_NORMALIZATION_CONTRACT.declarations.map((entry) => entry.name),
    "operator_declarations",
  );
  fixtureExactKeys(
    operatorHarnessProjection,
    ["contained_only", "kind", "path", "schema"],
    "operator_harness_projection_shape",
  );
  fixtureRequire(
    operatorHarnessProjection.schema ===
        "agenttool-phase-b-refence-maintenance-handshake-source-projection/v1" &&
      operatorHarnessProjection.kind === "operator_harness" &&
      operatorHarnessProjection.path === fixture.operator_harness_file.path,
    "operator_harness_projection_identity",
  );
  const declarationValues = operatorProjection.declarations as Record<
    string,
    string
  >;
  const audit = receipt.audit_evidence;
  fixtureExactKeys(
    auditSourceProjection,
    ["kind", "normalized_sha256", "path", "schema", "witness_keyset_sha256"],
    "audit_source_projection_shape",
  );
  fixtureExactKeys(
    auditHarnessProjection,
    ["contained_only", "kind", "path", "schema"],
    "audit_harness_projection_shape",
  );
  fixtureExactKeys(
    bridgeSourceProjection,
    ["kind", "normalized_sha256", "path", "schema", "source_schema"],
    "bridge_source_projection_shape",
  );
  fixtureRequire(
    auditSourceProjection.schema ===
        "agenttool-phase-b-refence-maintenance-handshake-source-projection/v1" &&
      auditSourceProjection.kind === "audit_source" &&
      auditSourceProjection.path === fixture.audit_source_file.path &&
      auditHarnessProjection.schema === auditSourceProjection.schema &&
      auditHarnessProjection.kind === "audit_harness" &&
      auditHarnessProjection.path === fixture.audit_harness_file.path &&
      bridgeSourceProjection.schema === auditSourceProjection.schema &&
      bridgeSourceProjection.kind === "bridge_source" &&
      bridgeSourceProjection.path === fixture.bridge_source_file.path,
    "projection_identities",
  );
  fixtureExactKeys(
    audit,
    [
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
    ],
    "audit_projection",
  );
  fixtureRequire(
    audit.verified === true && audit.lineage_bound === false &&
      audit.release_provenance_unbound === true &&
      audit.snapshots_non_atomic === true &&
      audit.release_created_at_order_safety_authority === false &&
      audit.release_current_image_linkage_proven === false &&
      audit.release_status_completion_authority === false &&
      audit.release_stable_rollout_authority === false &&
      audit.release_ledger_safety_authority === false &&
      audit.release_history_complete === false &&
      audit.release_history_may_be_truncated === true &&
      sha256(fixture.audit_source_file.bytes_utf8) === audit.source_sha256 &&
      auditSourceProjection.normalized_sha256 ===
        audit.source_normalized_sha256 &&
      auditSourceProjection.witness_keyset_sha256 ===
        "5f51c40ba3796125222b631af86b12263d12fdc8fa0701696105b90dbedb7867" &&
      sha256(fixture.audit_harness_file.bytes_utf8) === audit.harness_sha256 &&
      auditHarnessProjection.contained_only === true &&
      fixture.audit_witness_file.sha256 === audit.witness_sha256 &&
      canonicalJson(auditWitness) === canonicalJson(
          expectedAuditWitness(
            receipt.readmission_target.clean_526_ancestor_distance,
          ),
        ),
    "audit_binding",
  );
  fixtureRequire(
    declarationValues.OPERATOR_NORMALIZED_SHA256 ===
        receipt.operator_normalized_sha256 &&
      declarationValues.HARNESS_SHA256 === receipt.operator_harness_sha256 &&
      declarationValues.FULL_AUDIT_SHA256 === audit.source_sha256 &&
      declarationValues.FULL_AUDIT_NORMALIZED_SHA256 ===
        audit.source_normalized_sha256 &&
      declarationValues.FULL_AUDIT_HARNESS_SHA256 === audit.harness_sha256 &&
      declarationValues.FULL_AUDIT_WITNESS_SHA256 === audit.witness_sha256 &&
      declarationValues.READMISSION_BRIDGE_REVISION ===
        receipt.readmission_target.protected_main_revision &&
      declarationValues.READMISSION_BRIDGE_TREE ===
        receipt.readmission_target.protected_main_tree &&
      declarationValues.READMISSION_BRIDGE_DISTANCE_PIN ===
        String(receipt.readmission_target.clean_526_ancestor_distance),
    "operator_rebound_declarations",
  );
  const bridgeRaw = sha256(fixture.bridge_source_file.bytes_utf8);
  const bridgeNormalized = bridgeSourceProjection.normalized_sha256;
  fixtureRequire(
    bridgeRaw === receipt.readmission_guard_raw_sha256 &&
      bridgeNormalized === receipt.readmission_guard_normalized_sha256 &&
      /^[0-9a-f]{64}$/.test(bridgeNormalized) &&
      bridgeSourceProjection.source_schema ===
        "agenttool-phase-b-refence-maintenance-bridge/v1" &&
      declarationValues.READMISSION_GUARD_NORMALIZED_SHA256 ===
        bridgeNormalized,
    "bridge_binding",
  );

  const terminal = walDocuments.at(-1)!;
  const roles = terminal.context.roles;
  const machineIDs = [
    ...roles.app_lhr,
    roles.app_cdg,
    roles.thinker_primary,
    roles.thinker_standby,
  ];
  const machineSetSHA256 = sha256(`${bytewiseSorted(machineIDs).join("\n")}\n`);
  fixtureRequire(
    machineIDs.length === 5 && new Set(machineIDs).size === 5 &&
      machineIDs.every((id) => /^[0-9a-f]{14}$/.test(id)) &&
      machineSetSHA256 ===
        "a66acd74621df3aa8a9d70c8c051fa904280056bf90161c3f8c555407002b831" &&
      machineSetSHA256 === receipt.machine_set_sha256 &&
      machineSetSHA256 === terminal.context.machine_set_sha256 &&
      sha256(canonicalJson(roles)) === receipt.roles_sha256,
    "machine_binding",
  );

  const inventory = receipt.wal_inventory;
  fixtureExactKeys(
    inventory,
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
    "wal_inventory_shape",
  );
  fixtureRequire(
    inventory.entry_count === 4 && fixture.wal_files.length === 4 &&
      inventory.directory === fixture.expected_h0_layout.wal_directory_path &&
      canonicalJson(inventory.ordered_filenames) === canonicalJson(
          fixture.wal_files.map((file: Record<string, any>) =>
            basename(file.path)
          ),
        ) &&
      sha256(canonicalJson(inventory.ordered_filenames)) ===
        inventory.filename_set_sha256 &&
      sha256(canonicalJson(inventory.entries)) ===
        inventory.chain_projection_sha256,
    "wal_inventory_binding",
  );
  let prior: string | null = null;
  for (let index = 0; index < walDocuments.length; index += 1) {
    const wal = walDocuments[index]!;
    const file = fixture.wal_files[index]!;
    const projected = inventory.entries[index]!;
    fixtureExactKeys(
      wal,
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
      "wal_shape",
    );
    fixtureExactKeys(
      projected,
      [
        "ordinal",
        "filename",
        "sha256",
        "prior_entry_sha256",
        "checkpoint",
        "status",
        "mutation_armed",
      ],
      "wal_projection_shape",
    );
    fixtureRequire(
      wal.ordinal === index + 1 && wal.prior_entry_sha256 === prior &&
        projected.ordinal === wal.ordinal &&
        projected.prior_entry_sha256 === prior &&
        projected.filename === basename(file.path) &&
        projected.sha256 === file.sha256 &&
        projected.checkpoint === wal.checkpoint &&
        projected.status === wal.status &&
        projected.mutation_armed === wal.mutation_armed &&
        wal.run_id === receipt.run_id &&
        wal.operator_sha256 === receipt.operator_sha256 &&
        wal.operator_normalized_sha256 === receipt.operator_normalized_sha256 &&
        canonicalJson(wal.readmission_target) ===
          canonicalJson(receipt.readmission_target) &&
        canonicalJson(wal.audit_evidence) === canonicalJson(audit) &&
        wal.readmission_guard.path === fixture.bridge_source_file.path &&
        wal.readmission_guard.raw_sha256 === bridgeRaw &&
        wal.readmission_guard.normalized_sha256 === bridgeNormalized,
      "wal_chain",
    );
    prior = file.sha256;
  }
  fixtureRequire(
    inventory.first_entry_sha256 === fixture.wal_files[0].sha256 &&
      inventory.terminal_entry_sha256 === prior &&
      receipt.terminal_wal_entry_sha256 === prior &&
      receipt.wal_sha256_before_receipt === prior &&
      receipt.terminal_wal_entry_filename ===
        basename(fixture.wal_files.at(-1).path) &&
      receipt.terminal_wal_ordinal === 4 && terminal.terminal_proof !== null &&
      terminal.status === "fenced_awaiting_protected_main_readmission" &&
      terminal.checkpoint === "fenced_awaiting_protected_main_readmission",
    "wal_terminal",
  );
  const projectedCapsulePath =
    `${fixture.expected_h0_layout.wal_directory_path}/recovery-capsule.json`;
  fixtureRequire(
    receipt.recovery_capsule.path === projectedCapsulePath &&
      receipt.recovery_capsule.sha256 ===
        walDocuments[1].recovery_capsule.sha256 &&
      walDocuments[0].recovery_capsule === null &&
      walDocuments.slice(1).every((wal: Record<string, any>, index: number) =>
        wal.recovery_capsule.path === projectedCapsulePath &&
        wal.recovery_capsule.sha256 === receipt.recovery_capsule.sha256 &&
        wal.recovery_capsule.retired ===
          (index === walDocuments.length - 2)
      ),
    "projection_capsule_binding",
  );

  fixtureRequire(
    fixture.anchor_file.path ===
        fixture.expected_h0_layout.canonical_anchor_path &&
      fixture.armed_witness_file.path ===
        fixture.expected_h0_layout.canonical_witness_path &&
      fixture.anchor_file.sha256 === receipt.maintenance_anchor_sha256 &&
      fixture.armed_witness_file.sha256 === receipt.armed_witness.sha256 &&
      anchor.run_id === receipt.run_id &&
      armedWitness.run_id === receipt.run_id &&
      anchor.readmission_guard_path === fixture.bridge_source_file.path &&
      armedWitness.readmission_guard_path === fixture.bridge_source_file.path &&
      anchor.guard_raw_sha256 === bridgeRaw &&
      armedWitness.guard_raw_sha256 === bridgeRaw &&
      anchor.readmission_guard_normalized_sha256 === bridgeNormalized &&
      armedWitness.readmission_guard_normalized_sha256 === bridgeNormalized &&
      canonicalJson(anchor.readmission_target) ===
        canonicalJson(receipt.readmission_target) &&
      canonicalJson(armedWitness.readmission_target) ===
        canonicalJson(receipt.readmission_target) &&
      terminal.terminal_proof.maintenance_anchor_sha256 ===
        fixture.anchor_file.sha256 &&
      terminal.terminal_proof.armed_witness_sha256 ===
        fixture.armed_witness_file.sha256,
    "blocker_binding",
  );
  fixtureExactKeys(
    fixture.expected_h0_layout,
    [
      "edge",
      "canonical_anchor_path",
      "canonical_witness_path",
      "wal_directory_path",
      "anchor_archive_path",
      "witness_archive_path",
      "marker_stage_path",
      "required_present_paths",
      "required_absent_paths",
    ],
    "h0_shape",
  );
  fixtureRequire(
    fixture.expected_h0_layout.edge === "H0" &&
      canonicalJson(fixture.expected_h0_layout.required_present_paths) ===
        canonicalJson(bytewiseSorted(allFiles.map((file) => file.path))) &&
      canonicalJson(fixture.expected_h0_layout.required_absent_paths) ===
        canonicalJson(bytewiseSorted([
          fixture.expected_h0_layout.marker_stage_path,
          fixture.expected_h0_layout.anchor_archive_path,
          fixture.expected_h0_layout.witness_archive_path,
        ])) &&
      fixture.expected_h0_layout.required_absent_paths.every((path: string) =>
        !paths.has(path)
      ),
    "h0_inventory",
  );
  fixtureRequire(
    !/(?:postgres(?:ql)?:\/\/|FlyV[0-9] |(?:^|[^A-Za-z])FLY_ACCESS_TOKEN=|BEGIN [A-Z ]*PRIVATE KEY)/
      .test(bytes),
    "secret_redaction",
  );
  return fixture;
}

function rechainHandshakeFixture(
  fixtureInput: Record<string, any>,
): string {
  const fixture = structuredClone(fixtureInput);
  const receipt = JSON.parse(fixture.receipt_file.bytes_utf8);
  const walDocuments = fixture.wal_files.map((file: Record<string, any>) =>
    JSON.parse(file.bytes_utf8)
  );
  let prior: string | null = null;
  for (let index = 0; index < walDocuments.length; index += 1) {
    const wal = walDocuments[index]!;
    const file = fixture.wal_files[index]!;
    wal.prior_entry_sha256 = prior;
    file.bytes_utf8 = `${canonicalJson(wal)}\n`;
    file.sha256 = sha256(file.bytes_utf8);
    file.path = join(
      dirname(file.path),
      `${String(index + 1).padStart(6, "0")}-${file.sha256}.json`,
    );
    prior = file.sha256;
  }
  const inventory = receipt.wal_inventory;
  inventory.ordered_filenames = fixture.wal_files.map((
    file: Record<string, any>,
  ) => basename(file.path));
  inventory.entries = walDocuments.map((
    wal: Record<string, any>,
    index: number,
  ) => ({
    ordinal: wal.ordinal,
    filename: basename(fixture.wal_files[index].path),
    sha256: fixture.wal_files[index].sha256,
    prior_entry_sha256: wal.prior_entry_sha256,
    checkpoint: wal.checkpoint,
    status: wal.status,
    mutation_armed: wal.mutation_armed,
  }));
  inventory.first_entry_sha256 = inventory.entries[0].sha256;
  inventory.terminal_entry_sha256 = inventory.entries.at(-1).sha256;
  inventory.chain_projection_sha256 = sha256(
    canonicalJson(inventory.entries),
  );
  inventory.filename_set_sha256 = sha256(
    canonicalJson(inventory.ordered_filenames),
  );
  receipt.wal_sha256_before_receipt = inventory.terminal_entry_sha256;
  receipt.terminal_wal_entry_filename = inventory.ordered_filenames.at(-1);
  receipt.terminal_wal_entry_sha256 = inventory.terminal_entry_sha256;
  receipt.terminal_proof_recorded_wal_sha256 =
    inventory.entries[receipt.terminal_proof_recorded_wal_ordinal - 1].sha256;
  receipt.recovery_capsule.retirement_wal_sha256 =
    inventory.terminal_entry_sha256;
  fixture.receipt_file.bytes_utf8 = `${canonicalJson(receipt)}\n`;
  fixture.receipt_file.sha256 = sha256(fixture.receipt_file.bytes_utf8);

  const fixedFileKeys = [
    "operator_source_file",
    "operator_harness_file",
    "audit_source_file",
    "audit_harness_file",
    "audit_witness_file",
    "bridge_source_file",
    "receipt_file",
    "anchor_file",
    "armed_witness_file",
  ];
  const allFiles = [
    ...fixedFileKeys.map((key) => fixture[key]),
    ...fixture.wal_files,
  ];
  const directoryPaths = fixture.directories.map((entry: Record<string, any>) =>
    entry.path
  );
  for (const directory of fixture.directories) {
    directory.entries = bytewiseSorted(
      [
        ...allFiles.map((file: Record<string, any>) => file.path),
        ...directoryPaths,
      ].filter((path) =>
        path !== directory.path && dirname(path) === directory.path
      ).map((path) => basename(path)),
    );
  }
  fixture.expected_h0_layout.required_present_paths = bytewiseSorted(
    allFiles.map((file: Record<string, any>) => file.path),
  );
  return `${canonicalJson(fixture)}\n`;
}

interface ProductionShapeMutationHooks {
  beforeChain?: (documents: Record<string, any>) => void;
  afterAuthorityBindings?: (documents: Record<string, any>) => void;
  afterReceiptBindings?: (documents: Record<string, any>) => void;
  priorEntryOverrides?: Readonly<Record<number, string | null>>;
  filenameOverrides?: Readonly<Record<number, string>>;
}

function reboundProductionShapeAuthority(
  hooks: ProductionShapeMutationHooks = {},
) {
  const fixture = JSON.parse(readFileSync(PRODUCTION_SHAPE_FIXTURE, "utf8"));
  const documents: Record<string, any> = {
    receipt: JSON.parse(fixture.receipt_file.bytes_utf8),
    wal: fixture.wal_files.map((file: Record<string, any>) =>
      JSON.parse(file.bytes_utf8)
    ),
    anchor: JSON.parse(fixture.anchor_file.bytes_utf8),
    witness: JSON.parse(fixture.armed_witness_file.bytes_utf8),
  };
  hooks.beforeChain?.(documents);
  const records: Array<{
    value: Record<string, any>;
    sha256: string;
    filename: string;
  }> = [];
  const appendRecord = (index: number, prior: string | null) => {
    const value = documents.wal[index];
    value.prior_entry_sha256 = Object.hasOwn(
        hooks.priorEntryOverrides ?? {},
        index,
      )
      ? hooks.priorEntryOverrides![index]
      : prior;
    const bytes = `${JSON.stringify(value, null, 2)}\n`;
    const rawSHA256 = sha256(bytes);
    const record = {
      value,
      sha256: rawSHA256,
      filename: hooks.filenameOverrides?.[index] ??
        `${String(index + 1).padStart(6, "0")}-${rawSHA256}.json`,
    };
    records[index] = record;
    return record;
  };
  const first = appendRecord(0, null);
  const armed = appendRecord(1, first.sha256);
  const firstWal = first.value;
  const armedWal = armed.value;
  const terminalWal = documents.wal.at(-1);
  const terminalProofWal = documents.wal.at(-2);
  const guard = armedWal.readmission_guard;
  Object.assign(documents.anchor, {
    run_id: firstWal.run_id,
    source_revision: firstWal.source_revision,
    source_tree: firstWal.source_tree,
    wal_directory: documents.receipt.wal_inventory.directory,
    first_entry_filename: first.filename,
    first_entry_sha256: first.sha256,
    created_at: firstWal.updated_at,
    terminal_status: terminalWal.status,
    readmission_target: structuredClone(armedWal.readmission_target),
    readmission_guard_path: guard.path,
    readmission_guard_schema: guard.schema,
    readmission_guard_normalized_sha256: guard.normalized_sha256,
    guard_raw_sha256: guard.raw_sha256,
  });
  Object.assign(documents.witness, {
    run_id: armedWal.run_id,
    source_revision: armedWal.source_revision,
    source_tree: armedWal.source_tree,
    operator_path: armedWal.operator_path,
    operator_sha256: armedWal.operator_sha256,
    operator_normalized_sha256: armedWal.operator_normalized_sha256,
    armed_wal_ordinal: armedWal.ordinal,
    armed_wal_sha256: armed.sha256,
    armed_at: armedWal.updated_at,
    deploy_lock_device: armedWal.lock.device,
    deploy_lock_inode: armedWal.lock.inode,
    context_sha256: sha256(canonicalJson(armedWal.context)),
    admission_sha256: sha256(canonicalJson(armedWal.admission)),
    recovery_capsule_reference_sha256: sha256(
      canonicalJson(armedWal.recovery_capsule),
    ),
    terminal_status: terminalWal.status,
    readmission_target: structuredClone(armedWal.readmission_target),
    readmission_guard_path: guard.path,
    readmission_guard_schema: guard.schema,
    readmission_guard_normalized_sha256: guard.normalized_sha256,
    guard_raw_sha256: guard.raw_sha256,
  });
  hooks.afterAuthorityBindings?.(documents);
  const anchorBytes = `${JSON.stringify(documents.anchor, null, 2)}\n`;
  const witnessBytes = `${JSON.stringify(documents.witness, null, 2)}\n`;
  const anchorSHA256 = sha256(anchorBytes);
  const witnessSHA256 = sha256(witnessBytes);
  for (const wal of [terminalProofWal, terminalWal]) {
    if (wal.terminal_proof !== null) {
      wal.terminal_proof.maintenance_anchor_sha256 = anchorSHA256;
      wal.terminal_proof.armed_witness_sha256 = witnessSHA256;
      wal.terminal_proof.authorized_archive_path =
        documents.anchor.authorized_archive_path;
      wal.terminal_proof.readmission_guard_raw_sha256 =
        documents.anchor.guard_raw_sha256;
      wal.terminal_proof.readmission_guard_normalized_sha256 =
        documents.anchor.readmission_guard_normalized_sha256;
    }
  }
  for (let index = 2; index < documents.wal.length; index += 1) {
    appendRecord(index, records[index - 1]!.sha256);
  }
  const receipt = documents.receipt;
  const terminalRecord = records.at(-1)!;
  const proofRecord = records.at(-2)!;
  const context = terminalRecord.value.context;
  const terminalProof = terminalRecord.value.terminal_proof;
  Object.assign(receipt, {
    run_id: terminalRecord.value.run_id,
    status: terminalRecord.value.status,
    source_revision: terminalRecord.value.source_revision,
    source_tree: terminalRecord.value.source_tree,
    operator_path: terminalRecord.value.operator_path,
    operator_sha256: terminalRecord.value.operator_sha256,
    operator_normalized_sha256: terminalRecord.value.operator_normalized_sha256,
    readmission_target: structuredClone(
      terminalRecord.value.readmission_target,
    ),
    prior_audited_lineage: structuredClone(
      terminalRecord.value.prior_audited_lineage,
    ),
    audit_evidence: structuredClone(terminalRecord.value.audit_evidence),
    started_at: firstWal.started_at,
    completed_at: terminalRecord.value.updated_at,
    machine_set_sha256: context.machine_set_sha256,
    roles_sha256: sha256(canonicalJson(context.roles)),
    image_contract_sha256: sha256(canonicalJson(context.image)),
    restored_config_map_sha256: sha256(
      canonicalJson(context.restored_config_sha256_by_machine),
    ),
    fenced_config_map_sha256: sha256(
      canonicalJson(context.fenced_config_sha256_by_machine),
    ),
    wal_sha256_before_receipt: terminalRecord.sha256,
    terminal_wal_entry_filename: terminalRecord.filename,
    terminal_wal_entry_sha256: terminalRecord.sha256,
    terminal_wal_ordinal: terminalRecord.value.ordinal,
    terminal_checkpoint: terminalRecord.value.checkpoint,
    terminal_proof_recorded_wal_ordinal: proofRecord.value.ordinal,
    terminal_proof_recorded_wal_sha256: proofRecord.sha256,
    maintenance_anchor_sha256: anchorSHA256,
    maintenance_anchor_run_id: terminalRecord.value.run_id,
    ...(terminalProof === null ? {} : {
      terminal_fleet_sha256: terminalProof.fleet_sha256,
      terminal_proof: {
        fleet_sample_sha256: terminalProof.fleet_sample_sha256,
        drain_sample_sha256: terminalProof.drain_sample_sha256,
        journal_sha256: terminalProof.journal_sha256,
        authority_sha256: terminalProof.authority_sha256,
        provider_absence_sha256: terminalProof.provider_absence_sha256,
      },
    }),
    readmission_guard_raw_sha256: terminalRecord.value.readmission_guard
      .raw_sha256,
    readmission_guard_normalized_sha256: terminalRecord.value.readmission_guard
      .normalized_sha256,
    caveats: structuredClone(terminalRecord.value.caveats),
  });
  Object.assign(receipt.maintenance_anchor_handoff, {
    archive_path: documents.anchor.authorized_archive_path,
    authorized_guard_path: terminalRecord.value.readmission_guard.path,
    authorized_guard_schema: terminalRecord.value.readmission_guard.schema,
    guard_raw_sha256: terminalRecord.value.readmission_guard.raw_sha256,
    authorized_guard_normalized_sha256: terminalRecord.value.readmission_guard
      .normalized_sha256,
  });
  Object.assign(receipt.armed_witness, {
    path: documents.anchor.armed_witness_path,
    schema: documents.anchor.armed_witness_schema,
    sha256: witnessSHA256,
    run_id: terminalRecord.value.run_id,
    archive_path: documents.witness.authorized_archive_path,
  });
  Object.assign(receipt.recovery_capsule, {
    path: terminalRecord.value.recovery_capsule.path,
    sha256: terminalRecord.value.recovery_capsule.sha256,
    retired: terminalRecord.value.recovery_capsule.retired,
    retirement_wal_ordinal: terminalRecord.value.ordinal,
    retirement_wal_sha256: terminalRecord.sha256,
    retirement_checkpoint: terminalRecord.value.checkpoint,
  });
  const entries = records.map((record) => ({
    ordinal: record.value.ordinal,
    filename: record.filename,
    sha256: record.sha256,
    prior_entry_sha256: record.value.prior_entry_sha256,
    checkpoint: record.value.checkpoint,
    status: record.value.status,
    mutation_armed: record.value.mutation_armed,
  }));
  Object.assign(receipt.wal_inventory, {
    entry_count: records.length,
    ordered_filenames: records.map((record) => record.filename),
    entries,
    first_entry_sha256: first.sha256,
    terminal_entry_sha256: terminalRecord.sha256,
    chain_projection_sha256: sha256(canonicalJson(entries)),
    filename_set_sha256: sha256(canonicalJson(
      records.map((record) => record.filename),
    )),
  });
  hooks.afterReceiptBindings?.(documents);
  return {
    documents,
    request: {
      receipt,
      walRecords: records,
      anchor: { value: documents.anchor, sha256: anchorSHA256 },
      witness: { value: documents.witness, sha256: witnessSHA256 },
    },
  };
}

interface GeneratedBuildManifest {
  manifest: string;
  apiSourceCount: number;
  doctrineCount: number;
  fileCount: number;
  uniqueSourceCount: number;
  byteCount: number;
}

const BUILD_MANIFEST_REPOSITORY = realpathSync(
  join(import.meta.dir, "../.."),
);
const BUILD_FIXED_API_INPUTS = [
  "api/.dockerignore",
  "api/fly.toml",
  "api/Dockerfile",
  "api/package.json",
  "api/bun.lock",
  "api/tsconfig.json",
  "api/certs/supabase-prod-ca-2021.crt",
] as const;

async function runBuildManifestGit(
  arguments_: readonly string[],
  stdin?: string,
): Promise<Buffer> {
  const child = Bun.spawn(["/usr/bin/git", ...arguments_], {
    cwd: BUILD_MANIFEST_REPOSITORY,
    env: { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin" },
    stdin: stdin === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (stdin !== undefined) {
    child.stdin.write(stdin);
    child.stdin.end();
  }
  const [stdout, stderr, status] = await Promise.all([
    new Response(child.stdout).arrayBuffer(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (status !== 0 || stderr !== "") {
    throw new Error(`build_manifest_git_${arguments_[0] ?? "missing"}`);
  }
  return Buffer.from(stdout);
}

function replaceBridgeComparatorExact(
  source: string,
  before: string,
  after: string,
): string {
  fixtureRequire(
    source.split(before).length === 2,
    "bridge_pack_comparator",
  );
  return source.replace(before, after);
}

async function expandedBridgePackComparator(): Promise<string> {
  const base = (await runBuildManifestGit([
    "cat-file",
    "blob",
    "cc47a2c607c77827715e2865559cb53baa931dec",
  ])).toString("utf8");
  const changes = [
    [
      'const EXPECTED_BUILD_MANIFEST_SHA256 =\n  "2387ed54df4f8aedc663f07975030f09e5edbff40e316d8930a32ddf7e747e2a";',
      'const EXPECTED_BUILD_MANIFEST_SHA256 =\n  "ba1ee2dc3ede33e02460fd139273199db0d2c8e075976a28ff230543d46a7626";',
    ],
    [
      "const EXPECTED_BUILD_MANIFEST_BYTE_COUNT = 130_534;",
      "const EXPECTED_BUILD_MANIFEST_BYTE_COUNT = 130_718;",
    ],
    [
      "const EXPECTED_BUILD_FILE_COUNT = 706;",
      "const EXPECTED_BUILD_FILE_COUNT = 707;",
    ],
    [
      "const EXPECTED_BUILD_BYTE_COUNT = 10_094_465;",
      "const EXPECTED_BUILD_BYTE_COUNT = 10_102_535;",
    ],
    [
      "function parseGitTreeFiles(bytes: Uint8Array)",
      "export function parseGitTreeFiles(bytes: Uint8Array)",
    ],
    [
      'const expression = /const BRIDGE_NORMALIZED_SHA256 =\\n  "[^"]+";/;',
      'const expression = /const BRIDGE_NORMALIZED_SHA256 =\\n  "[0-9a-f]{64}";/;',
    ],
    [
      "'const BRIDGE_NORMALIZED_SHA256 =\\n  \"__BRIDGE_SELF_NORMALIZED_SHA256__\";'",
      "'const BRIDGE_NORMALIZED_SHA256 = \"__BRIDGE_SELF_NORMALIZED_SHA256__\";'",
    ],
    [
      "    const match = row.match(/^(100644|100755) blob ([0-9a-f]{40})\\t([^\\0]+)$/);",
      "    const match = row.match(\n      /^(100644|100755|120000) blob ([0-9a-f]{40})\\t([^\\0]+)$/,\n    );",
    ],
    [
      '      "build_git_tree",\n    );\n    result.set(path, {',
      '      "build_git_tree",\n    );\n    if (match[1] === "120000") continue;\n    result.set(path, {',
    ],
    ["          .length === 678 &&", "          .length === 679 &&"],
    ["        705,", "        706,"],
  ] as const;
  return changes.reduce(
    (source, [before, after]) =>
      replaceBridgeComparatorExact(source, before, after),
    base,
  );
}

async function readBuildManifestGitBatch(
  specifications: readonly string[],
): Promise<Array<{ sha1: string; bytes: Buffer }>> {
  fixtureRequire(
    specifications.length > 0 &&
      specifications.every((value) => !value.includes("\n")),
    "build_manifest_batch_input",
  );
  const output = await runBuildManifestGit(
    ["cat-file", "--batch"],
    `${specifications.join("\n")}\n`,
  );
  let cursor = 0;
  const records = specifications.map(() => {
    const lineEnd = output.indexOf(0x0a, cursor);
    fixtureRequire(lineEnd > cursor, "build_manifest_batch_header");
    const match = output.subarray(cursor, lineEnd).toString("utf8").match(
      /^([0-9a-f]{40}) blob ([0-9]+)$/,
    );
    fixtureRequire(match !== null, "build_manifest_batch_header");
    const size = Number(match[2]);
    fixtureRequire(
      Number.isSafeInteger(size) && size >= 0,
      "build_manifest_batch_size",
    );
    const start = lineEnd + 1;
    const end = start + size;
    fixtureRequire(
      end < output.byteLength && output[end] === 0x0a,
      "build_manifest_batch_bytes",
    );
    cursor = end + 1;
    return {
      sha1: match[1]!,
      bytes: Buffer.from(output.subarray(start, end)),
    };
  });
  fixtureRequire(cursor === output.byteLength, "build_manifest_batch_tail");
  return records;
}

async function generateBuildManifestFromTree(): Promise<
  GeneratedBuildManifest
> {
  const treeBytes = await runBuildManifestGit([
    "ls-tree",
    "-rz",
    "--full-tree",
    AUTHORIZED_H0_TARGET_REVISION,
    "--",
    "api",
    "docs",
  ]);
  fixtureRequire(
    treeBytes.byteLength > 0 && treeBytes.at(-1) === 0,
    "build_manifest_tree",
  );
  const tree = new Map<string, { mode: string; sha1: string }>();
  let ignoredSymlinks = 0;
  for (const row of treeBytes.subarray(0, -1).toString("utf8").split("\0")) {
    const match = row.match(
      /^(100644|100755|120000) blob ([0-9a-f]{40})\t([^\0]+)$/,
    );
    fixtureRequire(match !== null, "build_manifest_tree_row");
    if (match[1] === "120000") {
      ignoredSymlinks += 1;
      continue;
    }
    fixtureRequire(!tree.has(match[3]!), "build_manifest_tree_duplicate");
    tree.set(match[3]!, { mode: match[1]!, sha1: match[2]! });
  }
  fixtureRequire(ignoredSymlinks === 5, "build_manifest_tree_symlinks");
  const doctrineEntry = tree.get("api/doctrine-docs.manifest");
  fixtureRequire(doctrineEntry !== undefined, "build_manifest_doctrine");
  const [doctrineBlob] = await readBuildManifestGitBatch([
    doctrineEntry.sha1,
  ]);
  fixtureRequire(
    doctrineBlob !== undefined && doctrineBlob.sha1 === doctrineEntry.sha1,
    "build_manifest_doctrine",
  );
  const doctrineNames = doctrineBlob.bytes.toString("utf8").split("\n")
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  fixtureRequire(
    doctrineNames.every((name) =>
      /^(?!\.)[A-Za-z0-9][A-Za-z0-9.-]*\.(?:md|jsonld)$/.test(name)
    ),
    "build_manifest_doctrine",
  );
  const fixed = new Set<string>(BUILD_FIXED_API_INPUTS);
  const files: Array<{
    source: string;
    destination: string;
    mode: string;
    sha1: string;
  }> = [];
  for (const [source, metadata] of tree) {
    if (!source.startsWith("api/src/") && !fixed.has(source)) continue;
    files.push({
      source,
      destination: source.slice("api/".length),
      ...metadata,
    });
  }
  const add = (source: string, destination: string): void => {
    const metadata = tree.get(source);
    fixtureRequire(metadata !== undefined, "build_manifest_source");
    files.push({ source, destination, ...metadata });
  };
  add("docs/agenttool.jsonld", "agenttool.jsonld.bundled");
  add("docs/kingdom-bundle.json", "kingdom-bundle.json.bundled");
  for (const name of doctrineNames) {
    add(`docs/${name}`, `doctrine-docs.bundled/${name}`);
  }
  files.sort((left, right) =>
    Buffer.compare(
      Buffer.from(left.destination, "utf8"),
      Buffer.from(right.destination, "utf8"),
    )
  );
  const blobs = await readBuildManifestGitBatch(files.map((file) => file.sha1));
  let byteCount = 0;
  const rows = files.map((file, index) => {
    const blob = blobs[index]!;
    fixtureRequire(
      file.mode === "100644" && blob.sha1 === file.sha1,
      "build_manifest_tree_blob",
    );
    byteCount += blob.bytes.byteLength;
    return [
      file.destination,
      file.source,
      "100644",
      file.sha1,
      String(blob.bytes.byteLength),
      createHash("sha256").update(blob.bytes).digest("hex"),
    ].join("\t");
  });
  return {
    manifest: `${rows.join("\n")}\n`,
    apiSourceCount: files.filter((file) => file.source.startsWith("api/src/"))
      .length,
    doctrineCount: doctrineNames.length,
    fileCount: files.length,
    uniqueSourceCount: new Set(files.map((file) => file.source)).size,
    byteCount,
  };
}

async function generateBuildManifestFromReversePaths(): Promise<
  GeneratedBuildManifest
> {
  const apiSources = (await runBuildManifestGit([
    "ls-tree",
    "-rz",
    "--name-only",
    AUTHORIZED_H0_TARGET_REVISION,
    "--",
    "api/src",
  ])).toString("utf8").split("\0").filter(Boolean);
  const doctrineNames = (await runBuildManifestGit([
    "show",
    `${AUTHORIZED_H0_TARGET_REVISION}:api/doctrine-docs.manifest`,
  ])).toString("utf8").split("\n").filter((line) =>
    line.length > 0 && !line.startsWith("#")
  );
  const mappings = [
    ...apiSources.map((source) => ({
      source,
      destination: source.slice("api/".length),
    })),
    ...BUILD_FIXED_API_INPUTS.map((source) => ({
      source,
      destination: source.slice("api/".length),
    })),
    {
      source: "docs/agenttool.jsonld",
      destination: "agenttool.jsonld.bundled",
    },
    {
      source: "docs/kingdom-bundle.json",
      destination: "kingdom-bundle.json.bundled",
    },
    ...doctrineNames.map((name) => ({
      source: `docs/${name}`,
      destination: `doctrine-docs.bundled/${name}`,
    })),
  ].sort((left, right) =>
    Buffer.compare(
      Buffer.from(left.destination, "utf8"),
      Buffer.from(right.destination, "utf8"),
    )
  );
  const blobs = await readBuildManifestGitBatch(
    mappings.map((mapping) => `${AUTHORIZED_H0_TARGET_REVISION}:${mapping.source}`),
  );
  let byteCount = 0;
  const rows = mappings.map((mapping, index) => {
    const blob = blobs[index]!;
    const reversedSHA1 = createHash("sha1")
      .update(`blob ${blob.bytes.byteLength}\0`)
      .update(blob.bytes)
      .digest("hex");
    fixtureRequire(
      reversedSHA1 === blob.sha1,
      "build_manifest_reverse_blob",
    );
    byteCount += blob.bytes.byteLength;
    return [
      mapping.destination,
      mapping.source,
      "100644",
      reversedSHA1,
      String(blob.bytes.byteLength),
      createHash("sha256").update(blob.bytes).digest("hex"),
    ].join("\t");
  });
  return {
    manifest: `${rows.join("\n")}\n`,
    apiSourceCount: apiSources.length,
    doctrineCount: doctrineNames.length,
    fileCount: mappings.length,
    uniqueSourceCount: new Set(mappings.map((mapping) => mapping.source)).size,
    byteCount,
  };
}

describe("closed source normalization", () => {
  test("the literal d87 payload has two exact Git-only manifest reconstructions", async () => {
    const [tree, reverse] = await Promise.all([
      generateBuildManifestFromTree(),
      generateBuildManifestFromReversePaths(),
    ]);
    expect(reverse).toEqual(tree);
    expect(tree.apiSourceCount).toBe(679);
    expect(tree.doctrineCount).toBe(19);
    expect(tree.fileCount).toBe(707);
    expect(tree.uniqueSourceCount).toBe(706);
    expect(tree.byteCount).toBe(10_102_535);
    expect(Buffer.byteLength(tree.manifest)).toBe(130_718);
    expect(createHash("sha256").update(tree.manifest).digest("hex")).toBe(
      "ba1ee2dc3ede33e02460fd139273199db0d2c8e075976a28ff230543d46a7626",
    );
    const treeBytes = await runBuildManifestGit([
      "ls-tree",
      "-rz",
      "--full-tree",
      AUTHORIZED_H0_TARGET_REVISION,
      "--",
      "api",
      "docs",
    ]);
    const parsedTree = parseGitTreeFiles(treeBytes);
    expect(
      [...parsedTree.keys()].filter((path) => path.startsWith("api/src/")),
    ).toHaveLength(679);
    for (
      const ignored of [
        "docs/wakes/AGENTTOOL.bundle.json",
        "docs/wakes/AGENTTOOL.md",
        "docs/wakes/THE-SYZYGY.bundle.json",
        "docs/wakes/THE-SYZYGY.md",
        "docs/wakes/rendered",
      ]
    ) {
      expect(parsedTree.has(ignored)).toBe(false);
    }
    const required = "api/src/services/welcome/isness.ts";
    const treeText = treeBytes.toString("utf8");
    const requiredRow = treeText.match(
      new RegExp(`100644 blob ([0-9a-f]{40})\\t${required}\\0`),
    );
    expect(requiredRow).not.toBeNull();
    const requiredAsSymlink = Buffer.from(treeText.replace(
      `100644 blob ${requiredRow![1]}\t${required}\0`,
      `120000 blob ${requiredRow![1]}\t${required}\0`,
    ));
    const parsedRequiredSymlink = parseGitTreeFiles(requiredAsSymlink);
    expect(parsedRequiredSymlink.has(required)).toBe(false);
    expect(
      [...parsedRequiredSymlink.keys()].filter((path) =>
        path.startsWith("api/src/")
      ),
    ).toHaveLength(678);
    const source = readFileSync(
      join(import.meta.dir, "..", "phase-b-refence-maintenance-bridge.ts"),
      "utf8",
    );
    for (
      const literal of [
        '"ba1ee2dc3ede33e02460fd139273199db0d2c8e075976a28ff230543d46a7626"',
        "const EXPECTED_BUILD_MANIFEST_BYTE_COUNT = 130_718;",
        "const EXPECTED_BUILD_FILE_COUNT = 707;",
        "const EXPECTED_BUILD_BYTE_COUNT = 10_102_535;",
        ".length === 679 &&",
        ".size === 706,",
      ]
    ) {
      expect(source.split(literal)).toHaveLength(2);
    }
  });

  test(
    "the scanner line pack is parser-driven, deterministic, and idempotent",
    async () => {
      const expanded = await expandedBridgePackComparator();
      const expandedFacts = maintenanceBridgePackFacts(expanded);
      expect(expandedFacts.rawSHA256).toBe(
        "d6d47b2c66a656643c7389d92208260bf09167932b9bc510fe9348f5f58974fa",
      );
      expect(expandedFacts.byteCount).toBe(511_875);
      expect(expandedFacts.lineEntries).toBe(14_998);
      expect(expandedFacts.leafCount).toBe(75_920);
      expect(expandedFacts.leafSHA256).toBe(
        "6f60ec6ab232ab81b846e2cbac4055cfc13afa16ffe44b30a4f49eb19ef658ba",
      );
      expect(expandedFacts.astShapeSHA256).toBe(
        "1321bc4fa40a4d5ac013c7cc7643c63214ee92fe18799cc554704da5ba28cc63",
      );
      expect(expandedFacts.emittedLeafCount).toBe(63_850);
      expect(expandedFacts.emittedLeafSHA256).toBe(
        "81f549d54a6511ff6fb02c818bceb5e017072346290b0c3b85c32f1d0609f94f",
      );
      const packedExpanded = packMaintenanceBridgeSource(expanded);
      const packedExpandedFacts = maintenanceBridgePackFacts(packedExpanded);
      expect(packedExpanded.match(
        /const BRIDGE_NORMALIZED_SHA256 =\n  "[0-9a-f]{64}";/g,
      )).toHaveLength(1);
      expect(packedExpanded).not.toMatch(
        /^const BRIDGE_NORMALIZED_SHA256 = "[0-9a-f]{64}";$/m,
      );
      expect(packedExpandedFacts.leafCount).toBe(expandedFacts.leafCount);
      expect(packedExpandedFacts.leafSHA256).toBe(expandedFacts.leafSHA256);
      expect(packedExpandedFacts.astShapeSHA256).toBe(
        expandedFacts.astShapeSHA256,
      );
      expect(packedExpandedFacts.emittedLeafCount).toBe(
        expandedFacts.emittedLeafCount,
      );
      expect(packedExpandedFacts.emittedLeafSHA256).toBe(
        expandedFacts.emittedLeafSHA256,
      );
      expect(packedExpandedFacts.imports).toEqual(expandedFacts.imports);
      expect(packedExpandedFacts.exports).toEqual(expandedFacts.exports);
      expect(packedExpandedFacts.topLevelKinds).toEqual(
        expandedFacts.topLevelKinds,
      );
      expect(packedExpandedFacts.lineEntries).toBeLessThanOrEqual(
        BRIDGE_PACK_MAX_LINE_ENTRIES,
      );
      expect(packMaintenanceBridgeSource(packedExpanded)).toBe(packedExpanded);

      const current = readFileSync(
        join(import.meta.dir, "..", "phase-b-refence-maintenance-bridge.ts"),
        "utf8",
      );
      expect(current.split("\n")[1]).toBe(BRIDGE_PACK_DIRECTIVE);
      expect(current.match(
        /const BRIDGE_NORMALIZED_SHA256 =\n  "[0-9a-f]{64}";/g,
      )).toHaveLength(1);
      expect(packMaintenanceBridgeSource(current)).toBe(current);
      const currentFacts = maintenanceBridgePackFacts(current);
      expect(currentFacts.lineEntries).toBeLessThanOrEqual(
        BRIDGE_PACK_MAX_LINE_ENTRIES,
      );
      expect(currentFacts.longestLine).toBeLessThanOrEqual(320);
      expect(currentFacts.byteCount).toBeLessThan(512 * 1024);
      expect(currentFacts.leafCount).toBe(84_484);
      expect(currentFacts.leafSHA256).toBe(
        "854f31311cc07df76587f9971271865c32ecdbc24bd34fa1da598c98e6532997",
      );
      expect(currentFacts.astShapeSHA256).toBe(
        "f74ad8fd2c02d802ec62903c41e020fc3c9219484971993c8178786b08eac218",
      );
      expect(currentFacts.emittedLeafCount).toBe(71_366);
      expect(currentFacts.emittedLeafSHA256).toBe(
        "c535ea7cd343e13a6a19d3dd1600ceef6bfe69768889e379faaa6396b196c567",
      );
    },
    15_000,
  );

  test("shared producer envelope round-trips through the reverse consumer", () => {
    const bytes = readFileSync(HANDSHAKE_FIXTURE, "utf8");
    expect(Buffer.byteLength(bytes)).toBe(67_470);
    expect(sha256(bytes)).toBe(
      "8b91a41ac7134bbcbf3c7aa0d6c96c4a608548a3d020aa5740412e6a28f72722",
    );
    const fixture = validateHandshakeFixtureBytes(bytes);
    expect(`${canonicalJson(fixture)}\n`).toBe(bytes);

    const staleSemantic = structuredClone(fixture);
    const receipt = JSON.parse(staleSemantic.receipt_file.bytes_utf8);
    receipt.operator_normalized_sha256 = digest("b");
    staleSemantic.receipt_file.bytes_utf8 = `${canonicalJson(receipt)}\n`;
    staleSemantic.receipt_file.sha256 = sha256(
      staleSemantic.receipt_file.bytes_utf8,
    );
    expect(() =>
      validateHandshakeFixtureBytes(`${canonicalJson(staleSemantic)}\n`)
    ).toThrow(
      "fixture_operator_binding",
    );

    const noncanonicalMachineSet = structuredClone(fixture);
    const changedReceipt = JSON.parse(
      noncanonicalMachineSet.receipt_file.bytes_utf8,
    );
    const terminal = JSON.parse(
      noncanonicalMachineSet.wal_files.at(-1).bytes_utf8,
    );
    changedReceipt.machine_set_sha256 = sha256(canonicalJson([
      ...terminal.context.roles.app_lhr,
      terminal.context.roles.app_cdg,
      terminal.context.roles.thinker_primary,
      terminal.context.roles.thinker_standby,
    ].sort()));
    noncanonicalMachineSet.receipt_file.bytes_utf8 = `${
      canonicalJson(changedReceipt)
    }\n`;
    noncanonicalMachineSet.receipt_file.sha256 = sha256(
      noncanonicalMachineSet.receipt_file.bytes_utf8,
    );
    expect(() =>
      validateHandshakeFixtureBytes(
        `${canonicalJson(noncanonicalMachineSet)}\n`,
      )
    ).toThrow("fixture_machine_binding");
  });

  test("full producer-shape authority round-trips through the production validator", () => {
    const bytes = readFileSync(PRODUCTION_SHAPE_FIXTURE, "utf8");
    expect(Buffer.byteLength(bytes)).toBe(4_756_514);
    expect(sha256(bytes)).toBe(
      "a4e0427fcf54a70308683ca0ad868e537ed9bbd41eabb8b38114aa44d7f65da7",
    );
    expect(bytes.endsWith("\n")).toBeTrue();
    const fixture = JSON.parse(bytes);
    fixtureExactKeys(fixture, [
      "schema",
      "fixture_id",
      "synthetic_only",
      "test_only",
      "producer_shape",
      "authority_scope",
      "serialization",
      "producer_source",
      "expected_counts",
      "authority_claims",
      "proof_preimages",
      "receipt_file",
      "wal_files",
      "anchor_file",
      "armed_witness_file",
    ], "producer_shape_envelope");
    expect(fixture.schema).toBe(
      "agenttool-phase-b-refence-maintenance-production-shape-fixture/v1",
    );
    expect(fixture.fixture_id).toBe("deterministic-production-shape-003");
    expect(fixture.synthetic_only).toBeTrue();
    expect(fixture.test_only).toBeTrue();
    expect(fixture.producer_shape).toBeTrue();
    expect(fixture.authority_scope).toBe(
      "exact retained-artifact schema/transition/serialization and deterministic terminal commitment formulas under synthetic authority; launch/effect provenance unproved",
    );
    expect(fixture.serialization).toBe("JSON.stringify(value, null, 2) + LF");
    fixtureExactKeys(fixture.producer_source, [
      "path",
      "sha256",
      "normalized_sha256",
      "transformed_path",
      "transformed_sha256",
      "transformed_normalized_sha256",
      "transformed_normalization_basis",
      "authority_substitution_ids",
      "private_harness_transform_proof",
    ], "producer_shape_source");
    expect(fixture.producer_source.sha256).toBe(
      "7d01d59396488f9273c3b67818f3e958f886b10a8be9c1f2014131bde2fa044a",
    );
    expect(fixture.producer_source.normalized_sha256).toBe(
      "130fd8dce4d9c6e4aaf44d6870aae1da255c8502eb4f3f6c92dc4a71e95e2181",
    );
    expect(fixture.producer_source.transformed_sha256).toBe(
      "32280d94ca21464768f1b3402242041346900d8615d604298af86a55c9a9af7c",
    );
    expect(fixture.producer_source.transformed_normalized_sha256).toBe(
      "0f203a13fa091537f91f73f32747a75c889d1d5190e8292e253ed7598b498b91",
    );
    expect(fixture.producer_source.transformed_normalization_basis).toBe(
      "exact_ten_declaration_normalization_applied_directly_to_transformed_source",
    );
    expect(fixture.producer_source.authority_substitution_ids).toEqual([
      "readmission-target",
      "operator-and-audit-pins",
      "readmission-guard-normalized-pin",
      "operator-runtime-path",
      "machine-map-and-image-authority",
      "cron-pin",
    ]);
    expect(fixture.producer_source.authority_substitutions).toBeUndefined();
    expect(fixture.producer_source.private_harness_transform_proof).toEqual({
      algorithm:
        "reverse_six_unique_exact_substitutions_in_reverse_order_then_byte_compare",
      substitution_count: 6,
      reversed_sha256:
        "7d01d59396488f9273c3b67818f3e958f886b10a8be9c1f2014131bde2fa044a",
      reversed_normalized_sha256:
        "130fd8dce4d9c6e4aaf44d6870aae1da255c8502eb4f3f6c92dc4a71e95e2181",
      reversed_byte_equal_base: true,
      independently_reproducible_from_repo_fixture: false,
      launch_or_effect_provenance_claimed: false,
    });
    expect(fixture.authority_claims).toEqual({
      retained_artifact_schema_transition_serialization: true,
      deterministic_terminal_commitment_formulas: true,
      standalone_launch_authority: false,
      base_source_authority: false,
      launch_provenance_proven: false,
      effect_provenance_proven: false,
    });
    expect(fixture.expected_counts).toEqual({
      mutations: 13,
      wal_entries: 114,
      terminal_wal_ordinal: 114,
      events: 97,
      terminal_proof_wal_ordinal: 113,
    });
    const parsePrettyFile = (file: Record<string, any>) => {
      fixtureExactKeys(
        file,
        ["path", "bytes_utf8", "sha256", "metadata"],
        "producer_shape_file",
      );
      expect(file.metadata).toEqual({
        type: "file",
        uid: 501,
        gid: 20,
        mode: 0o600,
        nlink: 1,
      });
      const value = JSON.parse(file.bytes_utf8);
      expect(file.bytes_utf8).toBe(`${JSON.stringify(value, null, 2)}\n`);
      expect(sha256(file.bytes_utf8)).toBe(file.sha256);
      return value;
    };
    const receipt = parsePrettyFile(fixture.receipt_file);
    const anchor = parsePrettyFile(fixture.anchor_file);
    const witness = parsePrettyFile(fixture.armed_witness_file);
    const walRecords = fixture.wal_files.map((file: Record<string, any>) => ({
      value: parsePrettyFile(file),
      sha256: file.sha256,
      filename: basename(file.path),
    }));
    expect(receipt.operator_path).toBe(
      fixture.producer_source.transformed_path,
    );
    expect(receipt.operator_sha256).toBe(
      fixture.producer_source.transformed_sha256,
    );
    expect(receipt.operator_normalized_sha256).toBe(
      fixture.producer_source.transformed_normalized_sha256,
    );
    const authority = validateRefenceReceiptWalAuthorityForTest({
      receipt,
      walRecords,
      anchor: { value: anchor, sha256: fixture.anchor_file.sha256 },
      witness: { value: witness, sha256: fixture.armed_witness_file.sha256 },
    });
    expect(authority.schema).toBe(
      "agenttool-phase-b-refence-producer-authority/v1",
    );
    expect(authority.wal_entry_count).toBe(114);
    expect(authority.armed_wal_ordinal).toBe(2);
    expect(authority.armed_wal_sha256).toBe(fixture.wal_files[1].sha256);
    expect(authority.first_wal_sha256).toBe(fixture.wal_files[0].sha256);
    expect(authority.terminal_wal_sha256).toBe(
      fixture.wal_files[113].sha256,
    );
    expect(authority.anchor_sha256).toBe(fixture.anchor_file.sha256);
    expect(authority.witness_sha256).toBe(fixture.armed_witness_file.sha256);
    expect(authority.caveats_sha256).toBe(
      "60065bd2ec925ccbd7db5739700fc251d3c9d106fc4468c105423578c8d505db",
    );

    fixtureExactKeys(fixture.proof_preimages, [
      "source_inventory",
      "journal_rows",
      "terminal_journal_pair",
      "critical_contract",
      "deploy_receipt_inventory",
      "local_admission_state_pair",
      "provider_image_ref",
      "terminal_material_fleet",
      "terminal_fleet_fingerprints",
      "terminal_drain_snapshots",
      "terminal_authority",
      "terminal_provider_absence",
      "stable_fleet_interval_ms",
      "admission_proof_duration_ms",
      "terminal_round_interval_ms",
    ], "producer_shape_preimages");
    const proof = fixture.proof_preimages;
    const armedWal = walRecords[1].value;
    const terminalWal = walRecords.at(-1)!.value;
    const terminalProof = terminalWal.terminal_proof;
    expect(proof.source_inventory).toHaveLength(177);
    expect(proof.journal_rows).toHaveLength(177);
    expect(proof.source_inventory.map((entry: Record<string, any>) => {
      fixtureExactKeys(
        entry,
        ["filename", "checksum"],
        "producer_shape_source_inventory",
      );
      return entry.filename;
    })).toEqual(bytewiseSorted(
      proof.source_inventory.map((entry: Record<string, any>) =>
        entry.filename
      ),
    ));
    expect(
      new Set(
        proof.source_inventory.map((entry: Record<string, any>) =>
          entry.filename
        ),
      ).size,
    ).toBe(177);
    expect(proof.journal_rows.map((entry: Record<string, any>) => {
      fixtureExactKeys(
        entry,
        ["filename", "checksum", "applied_at"],
        "producer_shape_journal_row",
      );
      return { filename: entry.filename, checksum: entry.checksum };
    })).toEqual(proof.source_inventory);
    expect(sha256(canonicalJson(proof.source_inventory))).toBe(
      armedWal.context.source_inventory_sha256,
    );
    expect(sha256(canonicalJson(proof.journal_rows))).toBe(
      armedWal.context.journal_inventory_sha256,
    );
    fixtureExactKeys(
      proof.terminal_journal_pair,
      ["transaction", "session"],
      "producer_shape_journal_pair",
    );
    for (const endpoint of ["transaction", "session"] as const) {
      fixtureExactKeys(
        proof.terminal_journal_pair[endpoint],
        ["rows", "targetAppliedAt"],
        "producer_shape_journal_endpoint",
      );
      expect(proof.terminal_journal_pair[endpoint].rows).toEqual(
        proof.journal_rows,
      );
      expect(proof.terminal_journal_pair[endpoint].targetAppliedAt).toEqual([
        "2026-08-24T21:02:16.132506Z",
        "2026-08-24T21:02:16.520915Z",
      ]);
    }
    expect(proof.terminal_journal_pair.transaction).toEqual(
      proof.terminal_journal_pair.session,
    );
    expect(sha256(canonicalJson(proof.terminal_journal_pair))).toBe(
      terminalProof.journal_sha256,
    );
    expect(sha256(canonicalJson(proof.critical_contract))).toBe(
      armedWal.admission.embedded_critical_contract_sha256,
    );
    expect(sha256(canonicalJson(proof.deploy_receipt_inventory))).toBe(
      armedWal.admission.deploy_receipt_inventory_sha256,
    );
    expect(proof.deploy_receipt_inventory).toHaveLength(
      armedWal.admission.deploy_receipt_file_count,
    );
    expect(sha256(canonicalJson(proof.local_admission_state_pair))).toBe(
      armedWal.admission.local_state_sandwich_sha256,
    );
    fixtureExactKeys(proof.provider_image_ref, [
      "registry",
      "repository",
      "tag",
      "digest",
      "labels",
    ], "producer_shape_provider_image_ref");
    fixtureExactKeys(proof.provider_image_ref.labels, [
      "org.opencontainers.image.revision",
      "dev.agenttool.source.dirty",
    ], "producer_shape_provider_image_labels");
    expect(proof.provider_image_ref).toEqual({
      registry: "registry.fly.io",
      repository: "agenttool",
      tag: "synthetic-maintenance-image",
      digest:
        "sha256:5575c22f4419304811efc2dde447aa3359bb84eb4d5ae0bb2a6f8e55bc03c6b9",
      labels: {
        "org.opencontainers.image.revision":
          "526edc4ee0d076783d157591d7e3434352f6fc84",
        "dev.agenttool.source.dirty": "false",
      },
    });
    expect(sha256(canonicalJson(proof.provider_image_ref))).toBe(
      armedWal.context.image.fullImageRefSha256,
    );

    expect(proof.terminal_material_fleet).toHaveLength(5);
    const appMachineIDs = new Set([
      ...armedWal.context.roles.app_lhr,
      armedWal.context.roles.app_cdg,
    ]);
    const thinkerMachineIDs = new Set([
      armedWal.context.roles.thinker_primary,
      armedWal.context.roles.thinker_standby,
    ]);
    const exactImage =
      `${proof.provider_image_ref.registry}/${proof.provider_image_ref.repository}:` +
      `${proof.provider_image_ref.tag}@${proof.provider_image_ref.digest}`;
    const terminalMachineIDs = proof.terminal_material_fleet.map(
      (machine: Record<string, any>) => {
        fixtureExactKeys(machine, [
          "id",
          "state",
          "region",
          "instance_id",
          "updated_at",
          "cordoned",
          "host_status",
          "config",
          "image_ref",
        ], "producer_shape_material_fleet");
        fixtureExactKeys(machine.config, [
          "image",
          "env",
          "init",
          "metadata",
          "guest",
          "restart",
          "services",
        ], "producer_shape_material_config");
        expect(machine.image_ref).toEqual(proof.provider_image_ref);
        expect(machine.config.image).toBe(exactImage);
        expect(machine.state).toBe("stopped");
        expect(machine.host_status).toBe("ok");
        expect(machine.instance_id).toBe(
          `synthetic-instance-${Number.parseInt(machine.id[0]!, 10)}`,
        );
        if (appMachineIDs.has(machine.id)) {
          expect(machine.cordoned).toBeTrue();
          expect(machine.config).toEqual({
            image: exactImage,
            env: { AGENTTOOL_DISABLE_WORKERS: "1" },
            init: { cmd: ["bun", "run", "src/index.ts"] },
            metadata: { fly_process_group: "app" },
            guest: { cpu_kind: "shared", cpus: 1, memory_mb: 1_024 },
            restart: { policy: "no", max_retries: 10 },
            services: [{
              protocol: "tcp",
              internal_port: 3_000,
              autostart: false,
              autostop: false,
              min_machines_running: 1,
              ports: [
                { port: 80, handlers: ["http"] },
                { port: 443, handlers: ["tls", "http"] },
              ],
            }],
          });
        } else {
          expect(thinkerMachineIDs.has(machine.id)).toBeTrue();
          expect(machine.cordoned).toBeFalse();
          expect(machine.config).toEqual({
            image: exactImage,
            env: {
              AGENTTOOL_DISABLE_WORKERS: "1",
              AGENTOOL_ENABLE_THINKER: "1",
            },
            init: { cmd: ["bun", "run", "src/thinker.ts"] },
            metadata: { fly_process_group: "thinker" },
            guest: { cpu_kind: "shared", cpus: 1, memory_mb: 256 },
            restart: { policy: "no", max_retries: 10 },
            services: [],
          });
        }
        return machine.id;
      },
    );
    expect(terminalMachineIDs).toEqual(bytewiseSorted(terminalMachineIDs));
    expect(new Set(terminalMachineIDs).size).toBe(5);
    const fleetSHA256 = sha256(canonicalJson(proof.terminal_material_fleet));
    expect(proof.terminal_fleet_fingerprints).toEqual([
      fleetSHA256,
      fleetSHA256,
      fleetSHA256,
    ]);
    expect(terminalProof.fleet_sha256).toBe(fleetSHA256);
    expect(terminalProof.fleet_sample_sha256).toBe(
      sha256(canonicalJson(proof.terminal_fleet_fingerprints)),
    );
    for (const machine of proof.terminal_material_fleet) {
      const config = structuredClone(machine.config);
      delete config.image;
      expect(sha256(canonicalJson(config))).toBe(
        armedWal.context.fenced_config_sha256_by_machine[machine.id],
      );
    }

    expect(proof.terminal_drain_snapshots).toHaveLength(3);
    const producerZeroFields = [
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
    ];
    const drainEventSHA256s = terminalWal.events.filter(
      (event: Record<string, any>) =>
        event.kind === "proof" && event.action === "terminal_drain",
    ).map((event: Record<string, any>) => event.fleet_sha256);
    expect(drainEventSHA256s).toHaveLength(3);
    for (const [index, snapshot] of proof.terminal_drain_snapshots.entries()) {
      fixtureExactKeys(
        snapshot,
        ["counts", "informational", "cron_sha256"],
        "producer_shape_drain_snapshot",
      );
      expect(Object.keys(snapshot.counts)).toEqual(producerZeroFields);
      expect(bytewiseSorted(Object.keys(snapshot.counts))).toEqual(
        bytewiseSorted(producerZeroFields),
      );
      expect(Object.values(snapshot.counts)).toEqual(Array(30).fill(0));
      expect(snapshot.informational).toEqual({
        payout_requested: 0,
        x402_inserted: 0,
      });
      expect(snapshot.cron_sha256).toBe(armedWal.context.cron_sha256);
      expect(sha256(canonicalJson(snapshot))).toBe(drainEventSHA256s[index]);
    }
    expect(proof.terminal_drain_snapshots.map(canonicalJson)).toEqual(
      Array(3).fill(canonicalJson(proof.terminal_drain_snapshots[0])),
    );
    expect(terminalProof.drain_sample_sha256).toBe(
      sha256(canonicalJson(proof.terminal_drain_snapshots)),
    );
    fixtureExactKeys(proof.terminal_authority, [
      "authority_baseline_verified",
      "disabled_at",
      "allowed_origins_sha256",
      "reserved_generation_rows",
      "authoritative_v2_rows",
      "received_v1_rows",
    ], "producer_shape_terminal_authority");
    expect(proof.terminal_authority).toEqual({
      authority_baseline_verified: true,
      disabled_at: "2026-08-21T18:49:13.745704Z",
      allowed_origins_sha256:
        "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
      reserved_generation_rows: 0,
      authoritative_v2_rows: 0,
      received_v1_rows: 0,
    });
    expect(terminalProof.authority_sha256).toBe(
      sha256(canonicalJson(proof.terminal_authority)),
    );
    expect(terminalProof.authority_sha256).toBe(
      "e4f7bc0756d7075fa50d129455fcde637a177ddf23647a69554f7f2864ef7c55",
    );
    fixtureExactKeys(proof.terminal_provider_absence, [
      "app",
      "absent",
      "observations",
    ], "producer_shape_terminal_provider_absence");
    expect(proof.terminal_provider_absence).toEqual({
      app: "agenttool",
      absent: [
        "AGENTTOOL_COVENANT_V2_AUTHORITY_GENERATION",
        "REDIS_URL",
      ],
      observations: 2,
    });
    expect(terminalProof.provider_absence_sha256).toBe(
      sha256(canonicalJson(proof.terminal_provider_absence)),
    );
    expect(terminalProof.provider_absence_sha256).toBe(
      "888214699cb6a9eab515d75f2e3e7f152d43cc6f60c67d2ddc378637257f982f",
    );

    expect(proof.stable_fleet_interval_ms).toBe(1_137);
    expect(proof.admission_proof_duration_ms).toBe(10_274);
    expect(proof.terminal_round_interval_ms).toBe(5_137);
    const milliseconds = (value: string) => Date.parse(value);
    expect(milliseconds(walRecords[0].value.updated_at)).toBeLessThanOrEqual(
      milliseconds(armedWal.admission.proof_started_at),
    );
    expect(milliseconds(armedWal.admission.proof_started_at))
      .toBeLessThanOrEqual(
        milliseconds(armedWal.admission.proof_completed_at),
      );
    expect(milliseconds(armedWal.admission.proof_completed_at))
      .toBeLessThanOrEqual(milliseconds(armedWal.updated_at));
    expect(
      milliseconds(armedWal.admission.proof_completed_at) -
        milliseconds(armedWal.admission.proof_started_at),
    ).toBe(10_274);
    for (let index = 0; index < walRecords.length - 1; index += 1) {
      const first = walRecords[index].value;
      if (!first.checkpoint.endsWith("_readback_1")) continue;
      const second = walRecords[index + 1].value;
      expect(second.checkpoint.endsWith("_readback_2")).toBeTrue();
      expect(
        milliseconds(second.updated_at) - milliseconds(first.updated_at),
      ).toBe(1_137);
    }
    for (const sample of [1, 2]) {
      const drain = walRecords.find((record) =>
        record.value.checkpoint === `terminal_drain_sample_${sample}`
      )!.value;
      const nextFleet = walRecords.find((record) =>
        record.value.checkpoint === `terminal_fleet_sample_${sample + 1}`
      )!.value;
      expect(
        milliseconds(nextFleet.updated_at) - milliseconds(drain.updated_at),
      ).toBe(5_137);
    }

    for (
      const forbidden of [
        "8606e9ae201e98",
        "e82945ec50ee08",
        "8d9e16ce7573d8",
        "e829421fd1e628",
        "e820e09c6e7e28",
        "maintenance-526edc4ee0d0-20260824T210704Z-6e9e59cc185245bc",
        "sha256:ecb322baec96707f59603121cfd4613d08ff7b1da8bf338fa118453b45d3e72c",
        "maintenance-d1490e3fa517-20260822T003842Z-bafa822a004b4e3b",
        "sha256:db9a9017f83aa9187c1ed3a4c25056a0b0fd3fac0d18ea3c663e9dd1e7530dac",
        "8c27bb32b5306ebdc4fa4b630d58cd098203c0dd762ee2f0f42e73c9aef5c8d1",
        "0709af1a942960f1ba577c0896de3ff0172ec4b8f6ac2462a07b6c425845ada5",
        "22c6d715e02a1127fe73e743d41694bbe85aaa2bb3674a77703cdb469546fc34",
        "Private, one-way AgentTool Phase-B recovery operator.",
        "FLY_API_TOKEN",
        "postgres://",
        "postgresql://",
        "BEGIN PRIVATE KEY",
      ]
    ) expect(bytes).not.toContain(forbidden);
  });

  test(
    "full producer authority rejects deeply rebound semantic forgeries",
    () => {
      const rebound = reboundProductionShapeAuthority();
      expect(
        validateRefenceReceiptWalAuthorityForTest(rebound.request)
          .wal_entry_count,
      ).toBe(114);
      expect(sha256(canonicalJson({
        authority_baseline_verified: true,
        disabled_at: "2026-08-21T18:49:13.745704Z",
        allowed_origins_sha256:
          "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
        reserved_generation_rows: 0,
        authoritative_v2_rows: 0,
        received_v1_rows: 0,
      }))).toBe(
        "e4f7bc0756d7075fa50d129455fcde637a177ddf23647a69554f7f2864ef7c55",
      );
      expect(sha256(canonicalJson({
        app: "agenttool",
        absent: [
          "AGENTTOOL_COVENANT_V2_AUTHORITY_GENERATION",
          "REDIS_URL",
        ],
        observations: 2,
      }))).toBe(
        "888214699cb6a9eab515d75f2e3e7f152d43cc6f60c67d2ddc378637257f982f",
      );
      const cases: Array<{
        name: string;
        code: string;
        hooks: ProductionShapeMutationHooks;
      }> = [
        {
          name: "fixed caveat substitution",
          code: "producer_authority_projection",
          hooks: {
            beforeChain: ({ wal }) => {
              for (const entry of wal) entry.caveats[0] += " forged";
            },
          },
        },
        {
          name: "ordinal drift after full rechain",
          code: "producer_authority_wal",
          hooks: {
            beforeChain: ({ wal }) => wal[50].ordinal += 1,
          },
        },
        {
          name: "updated-at regression",
          code: "producer_authority_wal",
          hooks: {
            beforeChain: ({ wal }) => {
              wal[49].updated_at = wal[51].updated_at;
            },
          },
        },
        {
          name: "admission predates durable W1",
          code: "producer_authority_admission",
          hooks: {
            beforeChain: ({ wal }) => {
              for (const entry of wal.slice(1)) {
                entry.admission.proof_started_at = "2026-08-24T23:59:59.999Z";
              }
            },
          },
        },
        {
          name: "admission underclaims the two stable drain intervals",
          code: "producer_authority_admission",
          hooks: {
            beforeChain: ({ wal }) => {
              const started = Date.parse(wal[1].admission.proof_started_at);
              const completed = new Date(started + 10_273).toISOString();
              for (const entry of wal.slice(1)) {
                entry.admission.proof_completed_at = completed;
              }
            },
          },
        },
        {
          name: "single-WAL immutable audit drift",
          code: "producer_authority_wal",
          hooks: {
            beforeChain: ({ wal }) => {
              wal[50].audit_evidence.source_sha256 = digest("e");
            },
          },
        },
        {
          name: "event-checkpoint drift",
          code: "producer_authority_transition",
          hooks: {
            beforeChain: ({ wal }) => wal[2].events.at(-1).action = "stop",
          },
        },
        {
          name: "stable fleet readback pair underclaims 1137ms",
          code: "producer_authority_transition",
          hooks: {
            beforeChain: ({ wal }) => {
              const second = wal.find((entry: Record<string, any>) =>
                /_readback_2$/.test(entry.checkpoint)
              );
              const firstAt = Date.parse(second.events.at(-2).at);
              second.events.at(-1).at = new Date(firstAt + 1_136).toISOString();
            },
          },
        },
        {
          name: "terminal drain round underclaims 5137ms",
          code: "producer_authority_transition",
          hooks: {
            beforeChain: ({ wal }) => {
              const secondRound = wal.find((entry: Record<string, any>) =>
                entry.checkpoint === "terminal_fleet_sample_2"
              );
              const firstDrainAt = Date.parse(secondRound.events.at(-2).at);
              secondRound.events.at(-1).at = new Date(firstDrainAt + 5_136)
                .toISOString();
            },
          },
        },
        {
          name: "lock continuity drift",
          code: "producer_authority_transition",
          hooks: {
            beforeChain: ({ wal }) => wal[50].lock.inode += 1,
          },
        },
        {
          name: "globally rebound capsule path",
          code: "producer_authority_projection",
          hooks: {
            beforeChain: ({ wal }) => {
              for (const entry of wal.slice(1)) {
                entry.recovery_capsule.path += ".forged";
              }
            },
          },
        },
        {
          name: "raw-bound anchor truth drift",
          code: "producer_authority_anchor",
          hooks: {
            afterAuthorityBindings: ({ anchor }) => {
              anchor.no_secret_values = false;
            },
          },
        },
        {
          name: "raw-bound witness context drift",
          code: "producer_authority_witness",
          hooks: {
            afterAuthorityBindings: ({ witness }) => {
              witness.context_sha256 = digest("f");
            },
          },
        },
        {
          name: "terminal proof pending truth drift",
          code: "producer_authority_terminal",
          hooks: {
            beforeChain: ({ wal }) => {
              wal.at(-2).terminal_proof.capsule_retirement_pending = false;
              wal.at(-1).terminal_proof.capsule_retirement_pending = false;
            },
          },
        },
        {
          name: "normalization contract drift",
          code: "producer_authority_projection",
          hooks: {
            afterReceiptBindings: ({ receipt }) => {
              receipt.operator_normalization_contract.algorithm += "_forged";
            },
          },
        },
        {
          name: "receipt zero-effect truth drift",
          code: "producer_authority_handoff",
          hooks: {
            afterReceiptBindings: ({ receipt }) => {
              receipt.migration_attempt_count = 1;
            },
          },
        },
        {
          name: "hash-valid but nonderived WAL filename",
          code: "producer_authority_wal",
          hooks: {
            filenameOverrides: {
              50: `000051-${digest("a")}.json`,
            },
          },
        },
        {
          name: "fully rehashed wrong prior pointer",
          code: "producer_authority_wal",
          hooks: {
            priorEntryOverrides: { 50: digest("b") },
          },
        },
        {
          name: "reordered adjacent WAL values",
          code: "producer_authority_wal",
          hooks: {
            beforeChain: ({ wal }) => {
              [wal[50], wal[51]] = [wal[51], wal[50]];
            },
          },
        },
        {
          name: "inventory entry count drift",
          code: "producer_authority_projection",
          hooks: {
            afterReceiptBindings: ({ receipt }) => {
              receipt.wal_inventory.entry_count -= 1;
            },
          },
        },
        {
          name: "rehashed inventory projection drift",
          code: "producer_authority_wal",
          hooks: {
            afterReceiptBindings: ({ receipt }) => {
              receipt.wal_inventory.entries[50].checkpoint += "_forged";
              receipt.wal_inventory.chain_projection_sha256 = sha256(
                canonicalJson(receipt.wal_inventory.entries),
              );
            },
          },
        },
        {
          name: "filename-set encoding drift",
          code: "producer_authority_anchor",
          hooks: {
            afterReceiptBindings: ({ receipt }) => {
              receipt.wal_inventory.filename_set_sha256 = sha256(
                `${receipt.wal_inventory.ordered_filenames.join("\n")}\n`,
              );
            },
          },
        },
        {
          name: "receipt-to-W1 started time drift",
          code: "producer_authority_wal_capsule",
          hooks: {
            afterReceiptBindings: ({ receipt }) => {
              receipt.started_at = "2026-08-25T00:00:00.999Z";
            },
          },
        },
        {
          name: "common started time drift after arming",
          code: "producer_authority_event",
          hooks: {
            beforeChain: ({ wal }) => {
              wal[50].started_at = wal[50].updated_at;
            },
          },
        },
        {
          name: "anchor created time drift with raw rebound",
          code: "producer_authority_anchor",
          hooks: {
            afterAuthorityBindings: ({ anchor }) => {
              anchor.created_at = "2026-08-25T00:00:00.999Z";
            },
          },
        },
        {
          name: "armed witness time drift with raw rebound",
          code: "producer_authority_witness",
          hooks: {
            afterAuthorityBindings: ({ witness }) => {
              witness.armed_at = "2026-08-25T00:00:00.999Z";
            },
          },
        },
        {
          name: "receipt completed time drift",
          code: "producer_authority_anchor",
          hooks: {
            afterReceiptBindings: ({ receipt }) => {
              receipt.completed_at = "2026-08-25T00:00:00.999Z";
            },
          },
        },
        {
          name: "context changes after W2",
          code: "producer_authority_transition",
          hooks: {
            beforeChain: ({ wal }) => {
              wal[50].context.source_inventory_sha256 = digest("c");
            },
          },
        },
        {
          name: "admission changes after W2",
          code: "producer_authority_transition",
          hooks: {
            beforeChain: ({ wal }) => {
              wal[50].admission.local_state_sandwich_sha256 = digest("d");
            },
          },
        },
        {
          name: "capsule retires before terminal WAL",
          code: "producer_authority_transition",
          hooks: {
            beforeChain: ({ wal }) => {
              wal[50].recovery_capsule.retired = true;
            },
          },
        },
        {
          name: "terminal WAL leaves capsule active",
          code: "producer_authority_projection",
          hooks: {
            beforeChain: ({ wal }) => {
              wal.at(-1).recovery_capsule.retired = false;
            },
            afterReceiptBindings: ({ receipt }) => {
              receipt.recovery_capsule_retired = false;
            },
          },
        },
        {
          name: "witness capsule-reference drift",
          code: "producer_authority_witness",
          hooks: {
            afterAuthorityBindings: ({ witness }) => {
              witness.recovery_capsule_reference_sha256 = digest("a");
            },
          },
        },
        {
          name: "anchor first-WAL hash drift",
          code: "producer_authority_anchor",
          hooks: {
            afterAuthorityBindings: ({ anchor }) => {
              anchor.first_entry_sha256 = digest("b");
            },
          },
        },
        {
          name: "globally rebound wrong anchor archive",
          code: "producer_authority_handoff",
          hooks: {
            afterAuthorityBindings: ({ anchor }) => {
              anchor.authorized_archive_path += ".forged";
            },
          },
        },
        {
          name: "globally rebound wrong guard path",
          code: "producer_authority_wal",
          hooks: {
            beforeChain: ({ wal }) => {
              for (const entry of wal) {
                entry.readmission_guard.path += ".forged";
              }
            },
          },
        },
        {
          name: "witness armed ordinal drift",
          code: "producer_authority_witness",
          hooks: {
            afterAuthorityBindings: ({ witness }) => {
              witness.armed_wal_ordinal += 1;
            },
          },
        },
        {
          name: "witness armed raw-hash drift",
          code: "producer_authority_witness",
          hooks: {
            afterAuthorityBindings: ({ witness }) => {
              witness.armed_wal_sha256 = digest("c");
            },
          },
        },
        {
          name: "witness deploy-lock drift",
          code: "producer_authority_witness",
          hooks: {
            afterAuthorityBindings: ({ witness }) => {
              witness.deploy_lock_inode += 1;
            },
          },
        },
        {
          name: "witness admission-hash drift",
          code: "producer_authority_witness",
          hooks: {
            afterAuthorityBindings: ({ witness }) => {
              witness.admission_sha256 = digest("d");
            },
          },
        },
        {
          name: "terminal proof appears early",
          code: "producer_authority_terminal",
          hooks: {
            beforeChain: ({ wal }) => {
              wal[50].terminal_proof = structuredClone(
                wal.at(-2).terminal_proof,
              );
            },
          },
        },
        {
          name: "terminal proof is missing",
          code: "producer_authority_terminal",
          hooks: {
            beforeChain: ({ wal }) => {
              wal.at(-2).terminal_proof = null;
              wal.at(-1).terminal_proof = null;
            },
          },
        },
        {
          name: "terminal proof changes across retirement",
          code: "producer_authority_transition",
          hooks: {
            beforeChain: ({ wal }) => {
              wal.at(-1).terminal_proof.fleet_sha256 = digest("e");
            },
          },
        },
        {
          name: "globally rebound terminal fleet-sample formula",
          code: "producer_authority_terminal",
          hooks: {
            beforeChain: ({ wal }) => {
              wal.at(-2).terminal_proof.fleet_sample_sha256 = digest("c");
              wal.at(-1).terminal_proof.fleet_sample_sha256 = digest("c");
            },
            afterReceiptBindings: ({ receipt }) => {
              receipt.terminal_proof.fleet_sample_sha256 = digest("c");
            },
          },
        },
        {
          name: "terminal drain events disagree despite a rebound chain",
          code: "producer_authority_terminal",
          hooks: {
            beforeChain: ({ wal }) => {
              const drainWal = wal.at(-3);
              const proofWal = wal.at(-2);
              const terminalWal = wal.at(-1);
              drainWal.events.at(-1).fleet_sha256 = digest("d");
              proofWal.events.at(-1).fleet_sha256 = digest("d");
              terminalWal.events.at(-1).fleet_sha256 = digest("d");
            },
          },
        },
        {
          name: "globally rebound terminal authority formula",
          code: "producer_authority_terminal",
          hooks: {
            beforeChain: ({ wal }) => {
              wal.at(-2).terminal_proof.authority_sha256 = digest("a");
              wal.at(-1).terminal_proof.authority_sha256 = digest("a");
            },
            afterReceiptBindings: ({ receipt }) => {
              receipt.terminal_proof.authority_sha256 = digest("a");
            },
          },
        },
        {
          name: "globally rebound provider-absence formula",
          code: "producer_authority_terminal",
          hooks: {
            beforeChain: ({ wal }) => {
              wal.at(-2).terminal_proof.provider_absence_sha256 = digest("b");
              wal.at(-1).terminal_proof.provider_absence_sha256 = digest("b");
            },
            afterReceiptBindings: ({ receipt }) => {
              receipt.terminal_proof.provider_absence_sha256 = digest("b");
            },
          },
        },
        {
          name: "receipt terminal WAL pointer drift",
          code: "producer_authority_projection",
          hooks: {
            afterReceiptBindings: ({ receipt }) => {
              receipt.recovery_capsule.retirement_wal_sha256 = digest("f");
            },
          },
        },
        {
          name: "receipt terminal-proof pointer drift",
          code: "producer_authority_terminal",
          hooks: {
            afterReceiptBindings: ({ receipt }) => {
              receipt.terminal_proof_recorded_wal_ordinal -= 1;
              receipt.terminal_proof_recorded_wal_sha256 =
                receipt.wal_inventory.entries.at(-3).sha256;
            },
          },
        },
        {
          name: "normalizer receipt binding drift",
          code: "producer_authority_projection",
          hooks: {
            afterReceiptBindings: ({ receipt }) => {
              receipt.operator_normalization_contract.declarations[1]
                .receipt_binding = "operator_sha256";
            },
          },
        },
      ];
      for (const testCase of cases) {
        const forged = reboundProductionShapeAuthority(testCase.hooks);
        expectMaintenanceRefusalCode(
          () => validateRefenceReceiptWalAuthorityForTest(forged.request),
          testCase.code,
        );
      }
    },
    15_000,
  );

  test("live independent lock-owner UUID and distinct anchor/WAL authority validate exactly", () => {
    const ownerUUID = "02fa6a6e-4755-4725-b1cf-fc381797a7a7";
    const ownerID = `.phase-b-refence-lock-owner.28359.${ownerUUID}`;
    const ownerPath =
      `/Users/yournameisai/.local/state/agenttool/${ownerID}`;
    const bindLiveOwner = ({ wal }: Record<string, any>) => {
      for (const entry of wal) {
        entry.lock.pid = 28_359;
        entry.lock.owner_id = ownerID;
        entry.lock.owner_path = ownerPath;
      }
    };
    const live = reboundProductionShapeAuthority({ beforeChain: bindLiveOwner });
    expect(live.documents.wal[0].run_id).not.toBe(ownerUUID);
    expect(live.request.anchor.sha256).not.toBe(
      live.request.walRecords[0]!.sha256,
    );
    expect(
      validateRefenceReceiptWalAuthorityForTest(live.request).wal_entry_count,
    ).toBe(114);

    const mutations: Array<(wal: any[]) => void> = [
      (wal) => wal[50].lock.pid = 28_360,
      (wal) => wal[50].lock.owner_id =
        ".phase-b-refence-lock-owner.28359.02FA6A6E-4755-4725-B1CF-FC381797A7A7",
      (wal) => wal[50].lock.owner_path =
        "/Users/yournameisai/.local/state/agenttool/substituted-owner",
      (wal) => wal[50].lock.owner_id =
        ".phase-b-refence-lock-owner.28359.02fa6a6e-4755-4725-b1cf-fc381797a7a8",
    ];
    for (const mutate of mutations) {
      const forged = reboundProductionShapeAuthority({
        beforeChain: (documents) => {
          bindLiveOwner(documents);
          mutate(documents.wal);
        },
      });
      expectMaintenanceRefusalCode(
        () => validateRefenceReceiptWalAuthorityForTest(forged.request),
        "producer_authority_wal",
      );
    }
  });

  test("live H1 admission rejects a fully rechained restored-config forgery", () => {
    const forgedConfigSHA256 = digest("0");
    const forgedCriticalSHA256 = digest("1");
    const rebound = reboundProductionShapeAuthority({
      beforeChain: ({ wal }) => {
        for (const entry of wal.slice(1)) {
          const producerRoles = entry.context.roles;
          const ids = [
            ...producerRoles.app_lhr,
            producerRoles.app_cdg,
            producerRoles.thinker_primary,
            producerRoles.thinker_standby,
          ];
          entry.context.restored_config_sha256_by_machine = Object.fromEntries(
            ids.map((id) => [id, forgedConfigSHA256]),
          );
          entry.admission.embedded_critical_contract_sha256 =
            forgedCriticalSHA256;
        }
      },
    });
    expect(rebound.request.walRecords).toHaveLength(114);
    expect(rebound.request.walRecords.slice(1)).toHaveLength(113);
    expect(
      validateRefenceReceiptWalAuthorityForTest(rebound.request)
        .wal_entry_count,
    ).toBe(114);
    const armed = rebound.request.walRecords[1]!;
    expect(
      rebound.request.walRecords.slice(1).every((record) =>
        Object.values(
          record.value.context.restored_config_sha256_by_machine,
        ).every((value) => value === forgedConfigSHA256) &&
        record.value.admission.embedded_critical_contract_sha256 ===
          forgedCriticalSHA256 &&
        record.sha256 === sha256(
            `${JSON.stringify(record.value, null, 2)}\n`,
          ) &&
        record.filename ===
          `${
            String(record.value.ordinal).padStart(6, "0")
          }-${record.sha256}.json`
      ),
    ).toBeTrue();
    expect(rebound.request.receipt.restored_config_map_sha256).toBe(
      sha256(canonicalJson(
        armed.value.context.restored_config_sha256_by_machine,
      )),
    );
    expect(rebound.request.witness.value.armed_wal_sha256).toBe(armed.sha256);
    expect(rebound.request.witness.value.context_sha256).toBe(
      sha256(canonicalJson(armed.value.context)),
    );
    expect(rebound.request.witness.value.admission_sha256).toBe(
      sha256(canonicalJson(armed.value.admission)),
    );
    expect(
      sha256(`${JSON.stringify(rebound.request.receipt, null, 2)}\n`),
    ).toMatch(/^[0-9a-f]{64}$/);

    const fixture = guardFixture();
    fixture.evidence.roles = structuredClone(armed.value.context.roles);
    fixture.evidence.restoredConfigSHA256ByMachine = structuredClone(
      armed.value.context.restored_config_sha256_by_machine,
    );
    fixture.evidence.producerAdmission.embeddedCriticalContractSHA256 =
      armed.value.admission.embedded_critical_contract_sha256;
    const fleetProof = {
      fingerprint: fullFleetSHA256(stoppedFleet().fleet),
      nonImageConfigSHA256: digest("f"),
    };
    expectMaintenanceRefusalCode(
      () =>
        validateProducerEarlyRuntimeBindingsForTest({
          evidence: fixture.evidence,
          databaseProof: fixture.database as DatabaseProof,
          firstFleet: fleetProof,
          secondFleet: fleetProof,
        }),
      "producer_critical_contract",
    );
  });

  test("projection fixture rejects rechained caveat and capsule forgeries", () => {
    const fixture = validateHandshakeFixtureBytes(
      readFileSync(HANDSHAKE_FIXTURE, "utf8"),
    );
    const sourceReceipt = JSON.parse(fixture.receipt_file.bytes_utf8);
    expect(sha256(canonicalJson(sourceReceipt.caveats))).toBe(
      "60065bd2ec925ccbd7db5739700fc251d3c9d106fc4468c105423578c8d505db",
    );

    const caveatForgery = structuredClone(fixture);
    const forgedReceipt = JSON.parse(caveatForgery.receipt_file.bytes_utf8);
    forgedReceipt.caveats[0] += " forged";
    caveatForgery.receipt_file.bytes_utf8 = canonicalJson(forgedReceipt) + "\n";
    for (const file of caveatForgery.wal_files) {
      const wal = JSON.parse(file.bytes_utf8);
      wal.caveats[0] = forgedReceipt.caveats[0];
      file.bytes_utf8 = canonicalJson(wal) + "\n";
    }
    const caveatBytes = rechainHandshakeFixture(caveatForgery);
    const caveatEnvelope = JSON.parse(caveatBytes);
    expect(() => validateHandshakeFixtureBytes(caveatBytes)).toThrow(
      "fixture_producer_caveats_source_projection",
    );

    const capsuleForgery = structuredClone(fixture);
    const capsuleReceipt = JSON.parse(capsuleForgery.receipt_file.bytes_utf8);
    const forgedCapsulePath = capsuleReceipt.wal_inventory.directory +
      "/forged-recovery-capsule.json";
    capsuleReceipt.recovery_capsule.path = forgedCapsulePath;
    capsuleForgery.receipt_file.bytes_utf8 = canonicalJson(capsuleReceipt) +
      "\n";
    for (const file of capsuleForgery.wal_files) {
      const wal = JSON.parse(file.bytes_utf8);
      if (wal.recovery_capsule !== null) {
        wal.recovery_capsule.path = forgedCapsulePath;
      }
      file.bytes_utf8 = canonicalJson(wal) + "\n";
    }
    const capsuleBytes = rechainHandshakeFixture(capsuleForgery);
    expect(() => validateHandshakeFixtureBytes(capsuleBytes)).toThrow(
      "projection_capsule_binding",
    );
  });

  test("bridge normalization zeros only its unique self declaration", () => {
    const source = readFileSync(
      join(import.meta.dir, "..", "phase-b-refence-maintenance-bridge.ts"),
      "utf8",
    );
    const normalized = normalizedBridgeSource(source);
    expect(normalized).toContain(
      'const BRIDGE_NORMALIZED_SHA256 = "__BRIDGE_SELF_NORMALIZED_SHA256__";',
    );
    const pin = source.match(
      /const BRIDGE_NORMALIZED_SHA256 =\n  "([0-9a-f]{64})";/,
    );
    expect(pin).not.toBeNull();
    expect(pin![1]).toBe(sha256(normalized));
    expect(source).not.toContain("__PIN_BRIDGE_SELF_NORMALIZED_SHA256__");
    expect(normalized).toContain(
      "f4ff28f2bd46c608745e56ca82001c9e4252cc16e8e07252ca60c804f38ecf7f",
    );
    expect(() => normalizedBridgeSource(`${source}\n${source}`)).toThrow(
      MaintenanceRefenceError,
    );
    expect(() =>
      normalizedBridgeSource(
        source.replace(
          /const BRIDGE_NORMALIZED_SHA256 =\n  "[0-9a-f]{64}";\n/,
          "",
        ),
      )
    ).toThrow(MaintenanceRefenceError);
    expect(() =>
      normalizedBridgeSource(
        source.replace(pin![1], pin![1].toUpperCase()),
      )
    ).toThrow(MaintenanceRefenceError);
    expect(() =>
      normalizedBridgeSource(
        source.replace(pin![1], `${pin![1].slice(0, 63)}g`),
      )
    ).toThrow(MaintenanceRefenceError);
    const outsideMutation = source.replace(
      "Closed consumer for the one terminal",
      "Closed consumer for a single terminal",
    );
    expect(outsideMutation).not.toBe(source);
    expect(sha256(normalizedBridgeSource(outsideMutation))).not.toBe(pin![1]);
  });

  test("producer normalization mirrors the exact ordered ten-declaration contract", () => {
    const declarations = OPERATOR_NORMALIZATION_CONTRACT.declarations.map(
      (entry, index) =>
        index % 2 === 0
          ? `const ${entry.name} = "${digest(String(index % 10))}";`
          : `const ${entry.name} =\n  "${digest(String(index % 10))}";`,
    );
    const source = `${declarations.join("\n")}\n`;
    const normalized = normalizedRefenceOperator(source);
    for (const entry of OPERATOR_NORMALIZATION_CONTRACT.declarations) {
      expect(normalized).toContain(
        `const ${entry.name} = "${entry.replacement_token}";`,
      );
    }
    expect(() =>
      normalizedRefenceOperator(source.replace(declarations[0]!, ""))
    ).toThrow(
      MaintenanceRefenceError,
    );
    expect(() => normalizedRefenceOperator(`${source}${declarations[0]}\n`))
      .toThrow(
        MaintenanceRefenceError,
      );
  });

  test("audit normalizer and the literal 79-key witness are closed", () => {
    const audit = `const AUDIT_NORMALIZED_SHA256 =\n  "${digest("a")}";\n`;
    expect(normalizedFullAudit(audit)).toBe(
      'const AUDIT_NORMALIZED_SHA256 =\n  "0000000000000000000000000000000000000000000000000000000000000000";\n',
    );
    expect(() => normalizedFullAudit(`${audit}${audit}`)).toThrow(
      MaintenanceRefenceError,
    );
    const witness = expectedAuditWitness(37);
    expect(Object.keys(witness)).toHaveLength(79);
    expect(witness.git_526_to_protected_main_distance).toBe(37);
    expect(sha256(canonicalJson(Object.keys(witness).sort()))).toBe(
      "5f51c40ba3796125222b631af86b12263d12fdc8fa0701696105b90dbedb7867",
    );
  });

  test("controller CLI is the exact seven-flag receipt-bound form", () => {
    const arguments_ = [
      "--no-migrate",
      "--no-frontend",
      "--maintenance-fenced-api",
      `--maintenance-refence-receipt-sha256=${AUTHORIZED_H0_RECEIPT_SHA256}`,
      "--maintenance-app-machines=8606e9ae201e98,e82945ec50ee08,8d9e16ce7573d8",
      "--maintenance-thinker-primary=e829421fd1e628",
      "--maintenance-thinker-standby=e820e09c6e7e28",
    ];
    expect(parseArguments(arguments_).receiptSHA256).toBe(
      AUTHORIZED_H0_RECEIPT_SHA256,
    );
    expectMaintenanceRefusalCode(
      () => parseArguments([
        ...arguments_.slice(0, 3),
        `--maintenance-refence-receipt-sha256=${digest("a")}`,
        ...arguments_.slice(4),
      ]),
      "invalid_invocation",
    );
    expect(() =>
      parseArguments([
        "--no-migrate",
        "--no-frontend",
        "--maintenance-fenced-api",
        "--maintenance-refence-receipt-sha256",
        digest("a"),
        ...arguments_.slice(4),
      ])
    ).toThrow(MaintenanceRefenceError);
    expect(() => parseArguments([...arguments_, "--extra"])).toThrow(
      MaintenanceRefenceError,
    );
    expect(() => parseArguments([...arguments_].reverse())).toThrow(
      MaintenanceRefenceError,
    );
    expect(() =>
      parseArguments([
        ...arguments_.slice(0, -1),
        "--maintenance-thinker-standby=e829421fd1e628",
      ])
    ).toThrow(MaintenanceRefenceError);
    const source = readFileSync(
      join(import.meta.dir, "..", "phase-b-refence-maintenance-bridge.ts"),
      "utf8",
    );
    const parser = source.slice(
      source.indexOf("export function parseArguments("),
      source.indexOf("function comparePresentedRoles("),
    );
    expect(parser).not.toMatch(
      /maintenanceContract|loadVerifiedMaintenanceContract|CONTRACT_SOURCE/,
    );
    const main = source.slice(source.indexOf("async function main():"));
    expect(main.indexOf(
      'requireCondition(process.argv[2] === "controller", "invalid_invocation");',
    )).toBeLessThan(
      main.indexOf(
        "const arguments_ = parseArguments(process.argv.slice(3));",
      ),
    );
    expect(main.indexOf(
      "const arguments_ = parseArguments(process.argv.slice(3));",
    )).toBeLessThan(
      main.indexOf("await runProductionController(arguments_);"),
    );
    expect(main).not.toMatch(
      /maintenanceContract|loadVerifiedMaintenanceContract/,
    );
    expect(main.match(/parseArguments\(/g)).toHaveLength(1);
    expect(main.match(/runProductionController\(/g)).toHaveLength(1);
    expect(main).not.toContain("controller_not_activated");
    const selector = source.slice(
      source.indexOf("function requireAuthorizedH0Receipt("),
      source.indexOf(
        "/** @internal Exact immutable predecessor-H0 selector",
        source.indexOf("function requireAuthorizedH0Receipt("),
      ),
    );
    expect(selector).not.toMatch(
      /acquireDeployLock|readBoundedChild|fetchLiteralGitHubMain|runRefence|security|provider|database|keychain/i,
    );
  });

  test("artifact-directed JSON accepts producer pretty and historical raw receipts only", () => {
    const producer = { schema: "producer/v1", z: 1, a: { b: true } };
    const producerPretty = `${JSON.stringify(producer, null, 2)}\n`;
    expect(
      parsePrivateJsonDocumentForTest(
        Buffer.from(producerPretty),
        "pretty",
      ),
    ).toEqual(producer);
    expect(() =>
      parsePrivateJsonDocumentForTest(
        Buffer.from(`${canonicalJson(producer)}\n`),
        "pretty",
      )
    ).toThrow(MaintenanceRefenceError);

    const deployReceipt = {
      completed_at: "2026-08-25T12:00:00Z",
      exit_status: 0,
      external_mutation_started: false,
      outcome: "success",
      phases: [],
      release_head_snapshot: {},
      schema: "agenttool-deploy-receipt/v2",
      source_dirty: false,
      source_overrides: [],
      source_revision: AUTHORIZED_H0_TARGET_REVISION,
      verified_api_machines: [],
    };
    const deployPretty = `${JSON.stringify(deployReceipt, null, 2)}\n`;
    const deployCompact = `${JSON.stringify(deployReceipt)}\n`;
    expect(
      parsePrivateJsonDocumentForTest(
        Buffer.from(deployPretty),
        "raw_deploy_receipt",
      ),
    ).toEqual(deployReceipt);
    expect(
      parsePrivateJsonDocumentForTest(
        Buffer.from(deployCompact),
        "raw_deploy_receipt",
      ),
    ).toEqual(deployReceipt);
    const receiptName =
      "20260825T120000Z-d87a3f35c80b-1.json";
    expect(
      validateRawDeployReceiptForTest(receiptName, Buffer.from(deployPretty)),
    ).toEqual(deployReceipt);
    for (const invalid of [
      ` ${deployPretty}`,
      deployPretty.slice(0, -1),
      deployPretty.replace(/\n/g, "\r\n"),
      `\uFEFF${deployPretty}`,
      `${deployPretty}\n`,
    ]) {
      expect(() =>
        parsePrivateJsonDocumentForTest(
          Buffer.from(invalid),
          "raw_deploy_receipt",
        )
      ).toThrow(MaintenanceRefenceError);
    }
    expect(() =>
      validateRawDeployReceiptForTest(
        "20260825T120000Z-aaaaaaaaaaaa-1.json",
        Buffer.from(deployPretty),
      )
    ).toThrow(MaintenanceRefenceError);
    expect(() =>
      parsePrivateJsonDocumentForTest(
        Buffer.from(`${JSON.stringify({ ...deployReceipt, extra: true })}\n`),
        "raw_deploy_receipt",
      )
    ).toThrow(MaintenanceRefenceError);

    const anchor = {
      schema: "agenttool-phase-b-refence-observed-526-anchor/v1",
      value: true,
    };
    const marker = { schema: MAINTENANCE_MARKER_SCHEMA, value: true };
    expect(
      parsePrivateJsonDocumentForTest(
        Buffer.from(`${JSON.stringify(anchor, null, 2)}\n`),
        "producer_anchor_or_bridge_marker",
      ),
    ).toEqual(anchor);
    expect(
      parsePrivateJsonDocumentForTest(
        Buffer.from(`${canonicalJson(marker)}\n`),
        "producer_anchor_or_bridge_marker",
      ),
    ).toEqual(marker);
  });

  test("the immutable live H0 selector refuses every neighbouring authority", () => {
    const receipt = {
      run_id: AUTHORIZED_H0_RUN_ID,
      readmission_target: {
        protected_main_revision: AUTHORIZED_H0_TARGET_REVISION,
        protected_main_tree: AUTHORIZED_H0_TARGET_TREE,
        clean_526_ancestor_distance: 47,
      },
      readmission_guard_raw_sha256: AUTHORIZED_H0_GUARD_RAW_SHA256,
      readmission_guard_normalized_sha256:
        AUTHORIZED_H0_GUARD_NORMALIZED_SHA256,
    };
    expect(
      requireAuthorizedH0ReceiptForTest(
        receipt,
        AUTHORIZED_H0_RECEIPT_SHA256,
      ),
    ).toEqual({
      runID: AUTHORIZED_H0_RUN_ID,
      targetRevision: AUTHORIZED_H0_TARGET_REVISION,
      targetTree: AUTHORIZED_H0_TARGET_TREE,
      targetDistance: 47,
    });
    const mutations = [
      (value: any) => value.run_id = "789e8486-47cb-4b80-a165-c5ea557082d7",
      (value: any) => value.readmission_target.protected_main_revision = revision("a"),
      (value: any) => value.readmission_target.protected_main_tree = revision("b"),
      (value: any) => value.readmission_target.clean_526_ancestor_distance = 48,
      (value: any) => value.readmission_guard_raw_sha256 = digest("a"),
      (value: any) => value.readmission_guard_normalized_sha256 = digest("b"),
    ];
    for (const mutate of mutations) {
      const changed = structuredClone(receipt);
      mutate(changed);
      expect(() =>
        requireAuthorizedH0ReceiptForTest(
          changed,
          AUTHORIZED_H0_RECEIPT_SHA256,
        )
      ).toThrow(MaintenanceRefenceError);
    }
    expect(() =>
      requireAuthorizedH0ReceiptForTest(receipt, digest("f"))
    ).toThrow(MaintenanceRefenceError);
  });

  test("raw prior/current commits and exact repair/cumulative proofs refuse widening", async () => {
    const commit = (
      parents: readonly string[],
      tree = revision("f"),
    ) => {
      const bytes = Buffer.from([
        `tree ${tree}`,
        ...parents.map((parent) => `parent ${parent}`),
        "author Test <test@example.com> 1777777777 +0000",
        "committer Test <test@example.com> 1777777777 +0000",
        "",
        "protected successor",
        "",
      ].join("\n"));
      const oid = createHash("sha1")
        .update(`commit ${bytes.byteLength}\0`)
        .update(bytes)
        .digest("hex");
      return { bytes, oid, tree };
    };
    const exact = commit([IMMEDIATE_FAILED_COMPATIBILITY_REVISION, revision("1")]);
    expect(
      parseProtectedSuccessorParentsForTest(
        exact.bytes,
        exact.oid,
        exact.tree,
      ),
    ).toBe(revision("1"));
    const noTerminalLF = exact.bytes.subarray(0, exact.bytes.byteLength - 1);
    const noTerminalLFOID = createHash("sha1")
      .update(`commit ${noTerminalLF.byteLength}\0`)
      .update(noTerminalLF)
      .digest("hex");
    expect(
      parseProtectedSuccessorParentsForTest(
        noTerminalLF,
        noTerminalLFOID,
        exact.tree,
      ),
    ).toBe(revision("1"));
    for (const parents of [
      [AUTHORIZED_H0_TARGET_REVISION, revision("1")],
      [IMMEDIATE_FAILED_COMPATIBILITY_REVISION],
      [IMMEDIATE_FAILED_COMPATIBILITY_REVISION, revision("1"), revision("2")],
    ]) {
      const changed = commit(parents);
      expect(() =>
        parseProtectedSuccessorParentsForTest(
          changed.bytes,
          changed.oid,
          changed.tree,
        )
      ).toThrow(MaintenanceRefenceError);
    }
    expect(() =>
      parseProtectedSuccessorParentsForTest(
        exact.bytes,
        revision("e"),
        exact.tree,
      )
    ).toThrow(MaintenanceRefenceError);

    const malformed = (text: string) => {
      const bytes = Buffer.from(text);
      const oid = createHash("sha1")
        .update(`commit ${bytes.byteLength}\0`)
        .update(bytes)
        .digest("hex");
      expect(() =>
        parseProtectedSuccessorParentsForTest(bytes, oid, exact.tree)
      ).toThrow(MaintenanceRefenceError);
    };
    const exactText = exact.bytes.toString("utf8");
    malformed(exactText.replace(
      `parent ${IMMEDIATE_FAILED_COMPATIBILITY_REVISION}`,
      "parent",
    ));
    malformed(exactText.replace(
      `parent ${IMMEDIATE_FAILED_COMPATIBILITY_REVISION}`,
      `parent ${IMMEDIATE_FAILED_COMPATIBILITY_REVISION}\n forbidden-continuation`,
    ));
    malformed(exactText.replace(
      `tree ${exact.tree}`,
      `tree ${exact.tree}\ntree ${exact.tree}`,
    ));

    const realPriorCommit = await runBuildManifestGit([
      "--no-replace-objects",
      "cat-file",
      "commit",
      PRIOR_FAILED_COMPATIBILITY_REVISION,
    ]);
    expect(realPriorCommit).toHaveLength(1_246);
    expect(realPriorCommit.at(-1)).toBe("r".charCodeAt(0));
    expect(sha256(realPriorCommit)).toBe(
      PRIOR_FAILED_COMPATIBILITY_COMMIT_RAW_SHA256,
    );
    expect(
      createHash("sha1")
        .update(`commit ${realPriorCommit.byteLength}\0`)
        .update(realPriorCommit)
        .digest("hex"),
    ).toBe(PRIOR_FAILED_COMPATIBILITY_REVISION);
    expect(parsePriorFailedCompatibilityParentsForTest(
      realPriorCommit,
      PRIOR_FAILED_COMPATIBILITY_REVISION,
      PRIOR_FAILED_COMPATIBILITY_TREE,
    )).toBe(PRIOR_FAILED_COMPATIBILITY_TOPIC_REVISION);

    const realImmediateCommit = await runBuildManifestGit([
      "--no-replace-objects",
      "cat-file",
      "commit",
      IMMEDIATE_FAILED_COMPATIBILITY_REVISION,
    ]);
    expect(realImmediateCommit).toHaveLength(1_251);
    expect(realImmediateCommit.at(-1)).not.toBe("\n".charCodeAt(0));
    expect(sha256(realImmediateCommit)).toBe(
      IMMEDIATE_FAILED_COMPATIBILITY_COMMIT_RAW_SHA256,
    );
    expect(parseImmediateFailedCompatibilityParentsForTest(
      realImmediateCommit,
      IMMEDIATE_FAILED_COMPATIBILITY_REVISION,
      IMMEDIATE_FAILED_COMPATIBILITY_TREE,
    )).toBe(IMMEDIATE_FAILED_COMPATIBILITY_TOPIC_REVISION);

    const realPriorDiff = await runBuildManifestGit([
      "--no-replace-objects",
      "diff",
      "--raw",
      "-z",
      "--abbrev=40",
      "--no-renames",
      "--no-ext-diff",
      "--no-textconv",
      AUTHORIZED_H0_TARGET_REVISION,
      PRIOR_FAILED_COMPATIBILITY_REVISION,
      "--",
    ]);
    expect(parsePriorProtectedSuccessorChangedPathsForTest(realPriorDiff))
      .toEqual(PRIOR_PROTECTED_SUCCESSOR_CHANGED_PATH_STATUSES);
    expect(sha256(realPriorDiff)).toBe(
      "a66803eadc08fb8deb23fe3076deeadfc5310c1c6b5aeb50f5edc284511aaf28",
    );
    expect(sha256(canonicalJson(
      parsePriorProtectedSuccessorChangedPathsForTest(realPriorDiff),
    ))).toBe(
      "211620ae73940844daa44dad70dec9026d4f9759ea9abda4706abdc41ef81698",
    );

    const realImmediateDiff = await runBuildManifestGit([
      "--no-replace-objects",
      "diff",
      "--raw",
      "-z",
      "--abbrev=40",
      "--no-renames",
      "--no-ext-diff",
      "--no-textconv",
      PRIOR_FAILED_COMPATIBILITY_REVISION,
      IMMEDIATE_FAILED_COMPATIBILITY_REVISION,
      "--",
    ]);
    expect(parseImmediateProtectedSuccessorChangedPathsForTest(
      realImmediateDiff,
    )).toEqual(PROTECTED_SUCCESSOR_CHANGED_PATH_STATUSES);
    expect(sha256(realImmediateDiff)).toBe(
      "ea34fd5818a88c0554303040c9472d7b3699db15bbae5344c4b1e670577bc6f8",
    );
    const realImmediateCumulativeDiff = await runBuildManifestGit([
      "--no-replace-objects",
      "diff",
      "--raw",
      "-z",
      "--abbrev=40",
      "--no-renames",
      "--no-ext-diff",
      "--no-textconv",
      AUTHORIZED_H0_TARGET_REVISION,
      IMMEDIATE_FAILED_COMPATIBILITY_REVISION,
      "--",
    ]);
    expect(parsePriorProtectedSuccessorChangedPathsForTest(
      realImmediateCumulativeDiff,
    )).toEqual(PRIOR_PROTECTED_SUCCESSOR_CHANGED_PATH_STATUSES);
    expect(sha256(realImmediateCumulativeDiff)).toBe(
      "8d83631671ddfab6bc122d5b571df49ab0907c2e40ac1353f2663ccae407d7c2",
    );

    const rawDiff = (
      projection = PROTECTED_SUCCESSOR_CHANGED_PATH_STATUSES,
      unchangedBlobIndex?: number,
    ) =>
      Buffer.from(projection.map((entry, index) =>
        `:${entry.old_mode} ${entry.new_mode} ${String(index + 1).repeat(40).slice(0, 40)} ${String(unchangedBlobIndex === index ? index + 1 : index + 6).repeat(40).slice(0, 40)} ${entry.status}\0${entry.path}\0`
      ).join(""));
    expect(parseProtectedSuccessorChangedPathsForTest(rawDiff())).toEqual(
      PROTECTED_SUCCESSOR_CHANGED_PATH_STATUSES,
    );
    for (const mutate of [
      (value: any[]) => value.pop(),
      (value: any[]) => value.push({ ...value.at(-1), path: "bin/extra.ts" }),
      (value: any[]) => value[0].new_mode = "100644",
      (value: any[]) => value[1].status = "A",
      (value: any[]) => value[2].path = "bin/other.ts",
      (value: any[]) => value[4].old_mode = "100755",
      (value: any[]) => value[4].new_mode = "100755",
      (value: any[]) => value[4].status = "D",
      (value: any[]) =>
        value[4].path = "bin/tests/phase-b-refence-maintenance-other.test.ts",
      (value: any[]) => value.splice(3, 0, value.pop()),
    ]) {
      const changed = structuredClone(PROTECTED_SUCCESSOR_CHANGED_PATH_STATUSES) as any[];
      mutate(changed);
      expect(() =>
        parseProtectedSuccessorChangedPathsForTest(rawDiff(changed as any))
      ).toThrow(MaintenanceRefenceError);
    }
    expect(() =>
      parseProtectedSuccessorChangedPathsForTest(
        Buffer.concat([rawDiff(), Buffer.from("trailing\0")]),
      )
    ).toThrow(MaintenanceRefenceError);
    expect(() =>
      parseProtectedSuccessorChangedPathsForTest(rawDiff(
        PROTECTED_SUCCESSOR_CHANGED_PATH_STATUSES,
        4,
      ))
    ).toThrow(MaintenanceRefenceError);

    const revertedCumulative = structuredClone(
      PRIOR_PROTECTED_SUCCESSOR_CHANGED_PATH_STATUSES,
    ) as any[];
    expect(() => parsePriorProtectedSuccessorChangedPathsForTest(
      rawDiff(revertedCumulative as any, 0),
    )).toThrow(MaintenanceRefenceError);
  });

  test("typed three-generation proof never aliases raw closures or promotes a failure", () => {
    const fixture = guardFixture();
    const proof = protectedSuccessorGitProof(fixture.evidence);
    expect(
      validateProtectedSuccessorGitProofForTest(proof, fixture.evidence),
    ).toEqual(proof);
    const proofMutations = [
      (value: any) => value.revision = AUTHORIZED_H0_TARGET_REVISION,
      (value: any) => value.revision = PRIOR_FAILED_COMPATIBILITY_REVISION,
      (value: any) => value.revision = IMMEDIATE_FAILED_COMPATIBILITY_REVISION,
      (value: any) => value.source_distance = 53,
      (value: any) => value.commit_raw_sha256 = "not-a-sha",
      (value: any) => value.commit_byte_count = 0,
      (value: any) => value.first_parent_revision = revision("2"),
      (value: any) => value.second_parent_revision = value.revision,
      (value: any) => value.second_parent_tree = revision("2"),
      (value: any) => value.changed_paths_raw_sha256 =
        value.immediate_failed_compatibility_controller.changed_paths_raw_sha256,
      (value: any) => value.changed_path_statuses.pop(),
      (value: any) => value.cumulative_changed_paths_raw_sha256 =
        value.immediate_failed_compatibility_controller
          .cumulative_changed_paths_raw_sha256,
      (value: any) => value.changed_path_statuses[0].new_mode = "100644",
      (value: any) => value.cumulative_changed_path_statuses.pop(),
      (value: any) =>
        value.cumulative_changed_path_statuses[5].status = "D",
      (value: any) =>
        value.prior_failed_compatibility_controller.revision = revision("2"),
      (value: any) =>
        value.prior_failed_compatibility_controller.commit_raw_sha256 =
          digest("2"),
      (value: any) =>
        value.prior_failed_compatibility_controller.second_parent_tree =
          revision("2"),
      (value: any) =>
        value.prior_failed_compatibility_controller.changed_path_statuses.pop(),
      (value: any) =>
        value.prior_failed_compatibility_controller.changed_paths_raw_sha256 =
          digest("2"),
      (value: any) =>
        value.prior_failed_compatibility_controller.lifecycle = "current",
      (value: any) =>
        value.prior_failed_compatibility_controller.success_authority = true,
      (value: any) =>
        value.prior_failed_compatibility_controller.effect_authority = true,
      (value: any) =>
        value.prior_failed_compatibility_controller
          .observed_first_refusal_predicate = true,
      (value: any) =>
        value.immediate_failed_compatibility_controller.controller_exit_code = 0,
      (value: any) =>
        value.immediate_failed_compatibility_controller.downstream_effects
          .provider_effect_count = 1,
      (value: any) =>
        value.immediate_failed_compatibility_controller.changed_path_statuses.pop(),
      (value: any) =>
        value.immediate_failed_compatibility_controller
          .cumulative_changed_paths_raw_sha256 = digest("3"),
      (value: any) => value.authorized_h0_guard_raw_sha256 = digest("a"),
      (value: any) => value.bridge_source_sha256 = AUTHORIZED_H0_GUARD_RAW_SHA256,
      (value: any) => value.contract_source_sha256 = AUTHORIZED_H0_CONTRACT_RAW_SHA256,
      (value: any) => value.protected_head = false,
      (value: any) => value.clean = false,
    ];
    for (const mutate of proofMutations) {
      const changed = structuredClone(proof);
      mutate(changed);
      expect(() =>
        validateProtectedSuccessorGitProofForTest(changed, fixture.evidence)
      ).toThrow(MaintenanceRefenceError);
    }
    const evidenceMutations = [
      (value: any) => value.receiptSHA256 = digest("a"),
      (value: any) => value.runID = "789e8486-47cb-4b80-a165-c5ea557082d7",
      (value: any) => value.targetRevision = revision("a"),
      (value: any) => value.targetTree = revision("b"),
      (value: any) => value.targetDistance = 48,
      (value: any) => value.producerGuardNormalizedSHA256 = digest("b"),
    ];
    for (const mutate of evidenceMutations) {
      const changed = structuredClone(fixture.evidence);
      mutate(changed);
      expect(() =>
        validateProtectedSuccessorGitProofForTest(proof, changed)
      ).toThrow(MaintenanceRefenceError);
    }
  });

  test("post-H5 prepublication reuses the immutable compatibility controller binding", () => {
    const proof = protectedSuccessorGitProof(guardFixture().evidence);
    const binding = {
      controllerRevision: proof.revision,
      controllerTree: proof.tree,
      controllerSourceDistance: proof.source_distance,
      controllerCommitRawSHA256: proof.commit_raw_sha256,
      controllerCommitByteCount: proof.commit_byte_count,
      controllerTopicRevision: proof.second_parent_revision,
      controllerTopicTree: proof.second_parent_tree,
      changedPathsRawSHA256: proof.changed_paths_raw_sha256,
      changedPathStatusesSHA256: sha256(
        canonicalJson(proof.changed_path_statuses),
      ),
      cumulativeChangedPathsRawSHA256:
        proof.cumulative_changed_paths_raw_sha256,
      cumulativeChangedPathStatusesSHA256: sha256(
        canonicalJson(proof.cumulative_changed_path_statuses),
      ),
    };
    expect(validateCompatibilityControllerBindingsForTest(binding)).toEqual(
      binding,
    );
    for (const mutate of [
      (value: any) => value.controllerRevision = AUTHORIZED_H0_TARGET_REVISION,
      (value: any) => value.controllerRevision = PRIOR_FAILED_COMPATIBILITY_REVISION,
      (value: any) => value.controllerRevision = IMMEDIATE_FAILED_COMPATIBILITY_REVISION,
      (value: any) => value.controllerTree = AUTHORIZED_H0_TARGET_TREE,
      (value: any) => value.controllerTree = PRIOR_FAILED_COMPATIBILITY_TREE,
      (value: any) => value.controllerTree = IMMEDIATE_FAILED_COMPATIBILITY_TREE,
      (value: any) => value.controllerSourceDistance = 53,
      (value: any) => value.controllerCommitRawSHA256 = "not-a-sha",
      (value: any) => value.controllerCommitByteCount = 0,
      (value: any) => value.controllerTopicRevision = value.controllerRevision,
      (value: any) =>
        value.controllerTopicRevision = AUTHORIZED_H0_TARGET_REVISION,
      (value: any) => value.controllerTopicTree = revision("7"),
      (value: any) => value.changedPathsRawSHA256 =
        "ea34fd5818a88c0554303040c9472d7b3699db15bbae5344c4b1e670577bc6f8",
      (value: any) => value.changedPathStatusesSHA256 = digest("7"),
      (value: any) => value.cumulativeChangedPathsRawSHA256 =
        "8d83631671ddfab6bc122d5b571df49ab0907c2e40ac1353f2663ccae407d7c2",
      (value: any) => value.cumulativeChangedPathStatusesSHA256 = digest("7"),
    ]) {
      const changed = structuredClone(binding);
      mutate(changed);
      expect(() =>
        validateCompatibilityControllerBindingsForTest(changed)
      ).toThrow(MaintenanceRefenceError);
    }
    expect(() => validateCompatibilityControllerBindingsForTest(undefined))
      .toThrow(MaintenanceRefenceError);

    const source = readFileSync(
      join(import.meta.dir, "..", "phase-b-refence-maintenance-bridge.ts"),
      "utf8",
    );
    const guard = source.slice(
      source.indexOf("async function runMaintenanceRefenceGuardForController("),
      source.indexOf(
        "export function serializeMaintenanceRefenceProof(",
        source.indexOf(
          "async function runMaintenanceRefenceGuardForController(",
        ),
      ),
    );
    expect(guard).toContain("compatibilityController?:");
    expect(guard).toContain("compatibilityController, ");
    const prepublication = source.slice(
      source.indexOf("async function runProductionSpecialGuard("),
      source.indexOf(
        "/** @internal Exact silent service-process proof",
        source.indexOf("async function runProductionSpecialGuard("),
      ),
    );
    expect(prepublication).toContain(
      "session.guardDependencies, session.state.bindings",
    );
  });

  test("local Git config closes URL rewrites, includes, credentials, and worktree config", () => {
    const entries = [
      ["core.repositoryformatversion", "0"],
      ["core.filemode", "true"],
      ["core.bare", "false"],
      ["core.logallrefupdates", "true"],
      ["core.ignorecase", "true"],
      ["core.precomposeunicode", "true"],
      ["branch.main.remote", "github"],
      ["branch.main.merge", "refs/heads/main"],
      ["remote.github.url", "https://github.com/cambridgetcg/agenttool.git"],
      ["remote.github.fetch", "+refs/heads/*:refs/remotes/github/*"],
    ] as const;
    const bytes = (rows: readonly (readonly string[])[]) =>
      Buffer.from(rows.map(([key, value]) => `${key}\n${value}\0`).join(""));
    expect(validateGitLocalConfigForTest(bytes(entries))).toMatch(
      /^[0-9a-f]{64}$/,
    );
    for (const row of [
      ["url.https://evil.invalid/.insteadof", "https://github.com/"],
      ["include.path", "/tmp/authority"],
      ["http.proxy", "https://evil.invalid"],
      ["credential.helper", "!evil"],
      ["extensions.worktreeconfig", "true"],
    ]) {
      expect(() =>
        validateGitLocalConfigForTest(bytes([...entries, row]))
      ).toThrow(MaintenanceRefenceError);
    }
  });

  test("ordinary absent postflight is pinned to one exact canonical line", () => {
    const targetRevision = revision("a");
    const expected = expectedOrdinaryAbsentPostflightBytes(targetRevision);
    expect(Buffer.byteLength(expected)).toBe(397);
    expect(expected.endsWith("\n")).toBeTrue();
    expect(validateOrdinaryAbsentPostflightBytesForTest(
      Buffer.from(expected),
      targetRevision,
    )).toBe(sha256(expected));
    const mutations = [
      expected.slice(0, -1),
      expected.slice(0, -1) + "\r\n",
      expected.replace('"fleet_verified":false', '"fleet_verified":true'),
      expected.replace(targetRevision, revision("b")),
      expected.replace('"phase":"postflight"', '"phase":"preflight"'),
      expected.slice(0, -1) + ',"extra":true}\n',
    ];
    for (const mutation of mutations) {
      expect(() =>
        validateOrdinaryAbsentPostflightBytesForTest(
          Buffer.from(mutation),
          targetRevision,
        )
      ).toThrow("ordinary_postflight_proof");
    }
  });

  test("ordinary guard delegation binds the unchanged absent-only success path", () => {
    const guard = readFileSync(
      join(import.meta.dir, "..", "phase-b-deploy-guard.ts"),
    );
    const guardText = guard.toString("utf8");
    expect(guard.byteLength).toBe(68_763);
    expect(sha256(guard)).toBe(
      "10fe5012e8069ede11eaa3abe0a05f08225d855bb722d52746279dbc21c5fade",
    );
    expect(guardText.match(/\bBun\.spawn\(/g)).toHaveLength(2);
    expect(guardText).toContain(
      "const [exitCode, stdout] = await Promise.all([",
    );
    expect(guardText).toContain(
      "readBoundedStream(child.stderr, options.maximumBytes)",
    );
    expect(guardText).toContain(
      "timedOut || processGroupExists(Number(child.pid))",
    );
    expect(guardText).toContain("phase-b-authority-generation-active.json");
    expect(guardText).not.toContain("maintenance-active.json");
    expect(guardText).toContain(
      '["secrets", "list", "--json", "--app", APP]',
    );
    expect(guardText).toContain(
      '["machine", "list", "--app", APP, "--json"]',
    );
  });

  test("dependency preparation is local-only and its Git inputs are exact", () => {
    const sourcePath = join(
      import.meta.dir,
      "..",
      "phase-b-refence-maintenance-bridge.ts",
    );
    const source = readFileSync(sourcePath, "utf8");
    const start = source.indexOf(
      "async function prepareProductionDependencyEstate(",
    );
    const end = source.indexOf("function parseGitTreeFiles(", start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const preparation = source.slice(start, end);
    expect(preparation).not.toContain("readBoundedChild(");
    expect(preparation).not.toContain("registry.npmjs.org");
    expect(preparation).not.toContain('"install"');
    expect(preparation).toContain("readStablePostgresRuntimeSource(");
    expect(preparation).toContain("createExclusiveDurableFile(");
    expect(preparation).toContain(
      'AUTHORIZED_H0_TARGET_REVISION, "--", "api", "docs"',
    );
    expect(preparation).not.toContain('"HEAD", "--", "api", "docs"');
    const buildStart = source.indexOf(
      "async function prepareProductionBuildContext(",
    );
    const buildEnd = source.indexOf(
      "function requireBuildContext(",
      buildStart,
    );
    const buildPreparation = source.slice(buildStart, buildEnd);
    expect(buildPreparation).toContain(
      'AUTHORIZED_H0_TARGET_REVISION, "--", "api", "docs"',
    );
    expect(buildPreparation).not.toContain('"HEAD", "--", "api", "docs"');
    expect(source).toContain(
      'target.AGENTTOOL_GIT_REVISION!=="${evidence.targetRevision}"',
    );
    expect(source).not.toContain('import("../api/src/db/');
    expect(source).toContain(
      "689e732c8ffc35e0c5c3aac2d6328c915abd56eec5b77a5790da2d3b7a154b71",
    );

    const inputs = [
      [
        "api/package.json",
        1_574,
        "f879ba655bf3a8f006878341937ab5e2de2bb9574d052c45afde51d01e90668e",
      ],
      [
        "api/bun.lock",
        108_446,
        "45b125b4a88559edde90a5b1b0eb7ea446c482b20adbdaccebea6449a7d0ed86",
      ],
      [
        "api/tsconfig.json",
        483,
        "dc95a78b550175d03e9ef15b9ee484c736cd2c1e13d35bf482255a68f4f28c77",
      ],
      [
        "api/src/db/supabase-target.ts",
        10_245,
        "e7e41d1887c8dac0de5ca576126535437c4c0ca3d38ea876f3ca8d521cc6df4c",
      ],
      [
        "api/src/db/verified-postgres.ts",
        2_122,
        "20f14a983a39ce83198fa352b526dd4c4de4003f9b497e6f4ddf2c2d0aea442d",
      ],
      [
        "api/certs/supabase-prod-ca-2021.crt",
        1_367,
        "700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7",
      ],
    ] as const;
    const repository = realpathSync(join(import.meta.dir, "../.."));
    for (const [relativePath, expectedBytes, expectedSHA256] of inputs) {
      const bytes = readFileSync(join(repository, relativePath));
      expect(bytes.byteLength).toBe(expectedBytes);
      expect(sha256(bytes)).toBe(expectedSHA256);
    }
  });

  test("pure contract is byte-bound, import-free, deeply frozen, and closed", () => {
    const contractPath = realpathSync(
      join(import.meta.dir, "..", "phase-b-refence-maintenance-contract.ts"),
    );
    const bytes = readFileSync(contractPath);
    const source = bytes.toString("utf8");
    const stat = lstatSync(contractPath);
    const rawSHA256 = sha256(bytes);
    const blobSHA1 = createHash("sha1")
      .update(`blob ${bytes.byteLength}\0`)
      .update(bytes)
      .digest("hex");
    expect(stat.isFile()).toBeTrue();
    expect(stat.isSymbolicLink()).toBeFalse();
    expect(stat.mode & 0o777).toBe(0o644);
    expect(stat.nlink).toBe(1);
    expect(rawSHA256).toBe(
      "70e742ee541c495d42a9aeeb02a82bc0fe48b6de56139f12e3fe6496ae6b640b",
    );
    expect(blobSHA1).toBe("35fb32f3a25468533716d7e968a321a7f8d5b231");

    const transpiler = new Bun.Transpiler({ loader: "ts", target: "bun" });
    const scan = transpiler.scan(source);
    expect(scan.imports).toEqual([]);
    expect([...scan.exports].sort()).toEqual([
      "CONTRACT_SCHEMA",
      "createMaintenanceContract",
    ]);
    const transformed = String(transpiler.transformSync(source));
    const exactWallSource =
      "tests/integration/wall-self-witnessing.test.ts + wall-attester-key-binding.test.ts";
    const exactProcessCaveat =
      "Journal timestamps do not attribute either protected migration to this operator or a named process.";
    const exactGitFetchKey = "remote.github.fetch";
    expect(transformed.split(exactWallSource)).toHaveLength(2);
    expect(transformed.split(exactProcessCaveat)).toHaveLength(2);
    expect(transformed.split(exactGitFetchKey)).toHaveLength(2);
    expect(
      transformed.replace(exactWallSource, "").replace(exactProcessCaveat, "")
        .replace(exactGitFetchKey, ""),
    ).not.toMatch(
      /\b(globalThis|global|self|process|Bun|Deno|fetch|XMLHttpRequest|WebSocket|EventSource|Worker|SharedWorker|navigator|document|window|eval|Function|WebAssembly|Proxy|Reflect|Atomics|SharedArrayBuffer|Date|performance|setTimeout|setInterval|setImmediate|queueMicrotask|Intl|localeCompare|constructor|prototype|__proto__)\b|Math\s*\.\s*random|crypto\s*(?:\.|\[)|import\s*\.\s*meta/,
    );

    const contract = createMaintenanceContract({
      canonical: canonicalJson,
      digest: sha256,
      refuse: (code) => {
        throw new MaintenanceRefenceError(code);
      },
    });
    const deeplyFrozen = (
      value: unknown,
      seen = new Set<object>(),
    ): boolean => {
      if (value === null || typeof value !== "object") return true;
      if (seen.has(value)) return true;
      seen.add(value);
      return Object.isFrozen(value) &&
        Object.values(value as Record<string, unknown>).every((entry) =>
          deeplyFrozen(entry, seen)
        );
    };
    expect(CONTRACT_SCHEMA).toBe(
      "agenttool-phase-b-refence-maintenance-contract/v1",
    );
    expect(Object.keys(contract).sort()).toEqual([
      "applyRecoveryMarkerTransition",
      "bridgeMarkerSuccessAuthorityProjection",
      "classifyFlySSHAgentProcessRows",
      "controllerFlyArgv",
      "controllerOperationContract",
      "createCompatibilityHandoff",
      "createInitialBridgeMarker",
      "createSuccessArtifacts",
      "createSuccessAuthorityProjection",
      "databaseOriginContract",
      "expectedAuditWitness",
      "expectedOrdinaryAbsentPostflightBytes",
      "flySSHAgentAbsenceProjection",
      "flySSHAgentActiveProjection",
      "flySSHAgentDirectStopWalVerificationProjection",
      "flySSHAgentHolderPIDs",
      "flySSHAgentProtocolAuthorityProjection",
      "flySSHAgentProtocolOperationProjection",
      "flySSHAgentStableIdentityProjection",
      "localEvidenceFingerprint",
      "maintenanceDatabaseProofSQL",
      "normalizedFullAudit",
      "normalizedRefenceOperator",
      "parseCompatibilityChangedPaths",
      "parseFleetChildOutput",
      "parseFlySSHAgentLSOFText",
      "parseFlySSHAgentPSText",
      "parsePublicObservation",
      "previewSuccessFinalizationMarker",
      "producerCriticalContractSHA256",
      "producerLocalStateSandwichSHA256",
      "refenceOperatorDeclarationValues",
      "refenceOperatorImmutableCaveats",
      "requireFlySSHAgentAbsent",
      "requireFlySSHAgentActive",
      "runControllerRolloutCore",
      "runCordonedRuntimeCore",
      "runFinalAuthorityCore",
      "runFirstCanaryPublicCore",
      "runFlySSHAgentOwnedBatchCore",
      "runMaintenanceRefenceGuardCore",
      "runStoppedFenceCore",
      "schema",
      "validateBridgeMarkerTransition",
      "validateCompatibilityGitProof",
      "validateControllerWalEntry",
      "validateDatabaseConvergenceInheritedProof",
      "validateDatabaseConvergenceMarker",
      "validateDatabaseConvergenceTransition",
      "validateDatabaseOriginConvergence",
      "validateDatabaseProof",
      "validateFinalAuthority",
      "validateFirstCanaryPublic",
      "validateFleetTransition",
      "validateFlyAuthenticationConfigText",
      "validateFlySSHAgentObservation",
      "validateFlySSHAgentProtocolPing",
      "validateFlySSHAgentStopIntent",
      "validateGitLocalConfigText",
      "validateImmediateFailedCompatibilityGitProof",
      "validatePriorFailedCompatibilityGitProof",
      "validateProducerAuthorityProjection",
      "validateProducerEarlyRuntimeBindings",
      "validateProducerLocalStateSandwich",
      "validateProductionBridgeMarker",
      "validatePublicFederationAbout",
      "validatePublicHealth",
      "validateStoppedFleet",
      "validateSuccessArtifactBundle",
      "validateTargetFleet",
      "validateTargetFleetExpectation",
      "validateVerifiedDatabaseConvergence",
    ]);
    expect(Object.isFrozen(contract)).toBeTrue();
    expect(deeplyFrozen(contract.databaseOriginContract)).toBeTrue();
    const before = canonicalJson(contract.databaseOriginContract);
    expect(() =>
      (contract.databaseOriginContract.transaction_statements as any).push(
        "SELECT 1",
      )
    ).toThrow();
    expect(canonicalJson(contract.databaseOriginContract)).toBe(before);
    expect(() =>
      contract.controllerFlyArgv({ kind: "__proto__" } as any, "/fly")
    ).toThrow(MaintenanceRefenceError);
    expect(contract.controllerOperationContract({
      kind: "wait_started",
      machineID: "e829421fd1e628",
    })).toEqual({
      effectKind: "wait_machine",
      target: "e829421fd1e628",
      timeoutMilliseconds: 360_000,
    });
    expect(contract.controllerOperationContract({
      kind: "build_push",
      imageTag:
        "maintenance-refence-aaaaaaaaaaaa-20260825T120000Z-0123456789abcdef",
      revision: "a".repeat(40),
    })).toEqual({
      effectKind: "build_push",
      target: "agenttool",
      timeoutMilliseconds: 600_000,
    });
    const buildOperation = {
      kind: "build_push" as const,
      imageTag:
        "maintenance-refence-aaaaaaaaaaaa-20260825T120000Z-0123456789abcdef",
      revision: "a".repeat(40),
    };
    const exactBuildArgv = [
      "/fly",
      "deploy",
      "--app",
      "agenttool",
      "--config",
      "fly.toml",
      "--build-only",
      "--push",
      "--remote-only",
      "--wg=false",
      "--depot=auto",
      "--image-label",
      buildOperation.imageTag,
      "--skip-release-command",
      "--dns-checks=false",
      "--yes",
      "--build-arg",
      `AGENTTOOL_GIT_REVISION=${buildOperation.revision}`,
      "--build-arg",
      "AGENTTOOL_SOURCE_DIRTY=false",
    ];
    expect(contract.controllerFlyArgv(buildOperation, "/fly"))
      .toEqual(exactBuildArgv);
    const buildArgvMutations = [
      exactBuildArgv.filter((entry) => entry !== "--wg=false"),
      exactBuildArgv.map((entry) => entry === "--wg=false" ? "--wg=true" : entry),
      exactBuildArgv.filter((entry) => entry !== "--remote-only"),
      exactBuildArgv.filter((entry) => entry !== "--depot=auto"),
      exactBuildArgv.map((entry) => entry === "--depot=auto" ? "--depot=local" : entry),
      [...exactBuildArgv.slice(0, 8), "--local-only", ...exactBuildArgv.slice(8)],
      [...exactBuildArgv, "--wg=false"],
    ];
    for (const mutation of buildArgvMutations) {
      expect(canonicalJson(mutation)).not.toBe(canonicalJson(
        contract.controllerFlyArgv(buildOperation, "/fly"),
      ));
    }
    expect(() =>
      contract.controllerOperationContract({ kind: "constructor" } as any)
    ).toThrow(MaintenanceRefenceError);
    expect(contract.parseFleetChildOutput(
      new TextEncoder().encode('[{"id":"e829421fd1e628"}]\n'),
    )).toEqual([{ id: "e829421fd1e628" }]);
    expect(() =>
      contract.parseFleetChildOutput(new TextEncoder().encode("{}\n"))
    ).toThrow(MaintenanceRefenceError);

    const bridge = readFileSync(
      join(import.meta.dir, "..", "phase-b-refence-maintenance-bridge.ts"),
      "utf8",
    );
    expect(bridge).toContain(
      "canonicalJson(argv) === canonicalJson(armed.argv)",
    );
    expect(bridge).toContain(`"${rawSHA256}"`);
    expect(bridge).toContain(`"${blobSHA1}"`);
    expect(bridge).toContain("new Blob([Buffer.from(bytes)]");
    expect(bridge).toContain("URL.revokeObjectURL(moduleURL);");
    expect(bridge).toContain(
      '"show", "HEAD:bin/phase-b-refence-maintenance-contract.ts"',
    );
    expect(bridge).toMatch(
      /readStableRepositoryBlob\(\s*"bin\/phase-b-refence-maintenance-contract\.ts",\s*\{\s*mode: 0o644, objectSHA1: CONTRACT_SOURCE_GIT_BLOB\s*\},\s*\);/,
    );
  });

  test("portable contract bytes share the production export and freeze validator", async () => {
    const exact = containedContractBytes();
    await expect(validateMaintenanceContractBytesForTest(exact)).resolves
      .toBeUndefined();
    const mutated = Uint8Array.from(exact.bytes);
    mutated[mutated.byteLength - 2] ^= 1;
    for (
      const request of [
        { ...exact, bytes: mutated },
        { ...exact, sha256: digest("0") },
        { ...exact, gitBlobSHA1: revision("0") },
      ]
    ) {
      await expect(validateMaintenanceContractBytesForTest(request)).rejects
        .toThrow("maintenance_contract_source");
    }
    const bridge = readFileSync(
      join(import.meta.dir, "..", "phase-b-refence-maintenance-bridge.ts"),
      "utf8",
    );
    const production = bridge.slice(
      bridge.indexOf("async function loadVerifiedMaintenanceContract("),
      bridge.indexOf(
        "/** @internal Validates caller-read",
        bridge.indexOf(
          "async function loadVerifiedMaintenanceContract(",
        ),
      ),
    );
    const contained = bridge.slice(
      bridge.indexOf(
        "export async function loadMaintenanceContractForContainedTest(",
      ),
      bridge.indexOf(
        "/** @internal Fresh exact-byte validator",
        bridge.indexOf(
          "export async function loadMaintenanceContractForContainedTest(",
        ),
      ),
    );
    expect(production.match(/readStableRepositoryBlob\(/g)).toHaveLength(2);
    expect(production).toContain("realpathSync(CONTRACT_SOURCE)");
    expect(production).toContain("sameFileIdentity(before.stat, after.stat)");
    expect(contained).not.toMatch(
      /CONTRACT_SOURCE|REPOSITORY_ROOT|OPERATOR_UID|readStableRepositoryBlob|process\.env/,
    );
  });

  test("Git reader allowlist covers exact contract proof forms and refuses near misses", () => {
    const sourceRevision = "526edc4ee0d076783d157591d7e3434352f6fc84";
    const remoteMain = "refs/remotes/github/main";
    const exactProofCommands = [
      ["config", "--local", "--null", "--list"],
      ["rev-parse", "--git-common-dir"],
      ["for-each-ref", "--format=%(refname)", "refs/replace/"],
      ["rev-parse", "HEAD"],
      ["rev-parse", remoteMain],
      ["rev-parse", "HEAD^{tree}"],
      ["rev-parse", "HEAD^2^{tree}"],
      ["rev-parse", `${AUTHORIZED_H0_TARGET_REVISION}^{tree}`],
      ["rev-parse", `${PRIOR_FAILED_COMPATIBILITY_REVISION}^{tree}`],
      ["rev-parse", `${PRIOR_FAILED_COMPATIBILITY_TOPIC_REVISION}^{tree}`],
      ["rev-parse", `${IMMEDIATE_FAILED_COMPATIBILITY_REVISION}^{tree}`],
      ["rev-parse", `${IMMEDIATE_FAILED_COMPATIBILITY_TOPIC_REVISION}^{tree}`],
      ["rev-list", "--count", `${sourceRevision}..HEAD`],
      [
        "rev-list",
        "--count",
        `${sourceRevision}..${PRIOR_FAILED_COMPATIBILITY_REVISION}`,
      ],
      [
        "rev-list",
        "--count",
        `${sourceRevision}..${IMMEDIATE_FAILED_COMPATIBILITY_REVISION}`,
      ],
      ["cat-file", "commit", "HEAD"],
      ["cat-file", "commit", PRIOR_FAILED_COMPATIBILITY_REVISION],
      ["cat-file", "commit", IMMEDIATE_FAILED_COMPATIBILITY_REVISION],
      ["merge-base", "--is-ancestor", sourceRevision, "HEAD"],
      [
        "merge-base",
        "--is-ancestor",
        IMMEDIATE_FAILED_COMPATIBILITY_REVISION,
        "HEAD^2",
      ],
      ["status", "--porcelain=v1", "--untracked-files=all"],
      [
        "diff",
        "--raw",
        "-z",
        "--abbrev=40",
        "--no-renames",
        "--no-ext-diff",
        "--no-textconv",
        AUTHORIZED_H0_TARGET_REVISION,
        PRIOR_FAILED_COMPATIBILITY_REVISION,
        "--",
      ],
      [
        "diff",
        "--raw",
        "-z",
        "--abbrev=40",
        "--no-renames",
        "--no-ext-diff",
        "--no-textconv",
        PRIOR_FAILED_COMPATIBILITY_REVISION,
        IMMEDIATE_FAILED_COMPATIBILITY_REVISION,
        "--",
      ],
      [
        "diff",
        "--raw",
        "-z",
        "--abbrev=40",
        "--no-renames",
        "--no-ext-diff",
        "--no-textconv",
        AUTHORIZED_H0_TARGET_REVISION,
        IMMEDIATE_FAILED_COMPATIBILITY_REVISION,
        "--",
      ],
      [
        "diff",
        "--raw",
        "-z",
        "--abbrev=40",
        "--no-renames",
        "--no-ext-diff",
        "--no-textconv",
        IMMEDIATE_FAILED_COMPATIBILITY_REVISION,
        "HEAD",
        "--",
      ],
      [
        "diff",
        "--raw",
        "-z",
        "--abbrev=40",
        "--no-renames",
        "--no-ext-diff",
        "--no-textconv",
        AUTHORIZED_H0_TARGET_REVISION,
        "HEAD",
        "--",
      ],
      ["show", "HEAD:bin/phase-b-refence-maintenance-bridge.ts"],
      [
        "show",
        `${PRIOR_FAILED_COMPATIBILITY_REVISION}:bin/phase-b-refence-maintenance-bridge.ts`,
      ],
      [
        "show",
        `${IMMEDIATE_FAILED_COMPATIBILITY_REVISION}:bin/phase-b-refence-maintenance-bridge.ts`,
      ],
      [
        "show",
        `${AUTHORIZED_H0_TARGET_REVISION}:bin/phase-b-refence-maintenance-bridge.ts`,
      ],
      ["show", "HEAD:bin/phase-b-refence-maintenance-contract.ts"],
      [
        "show",
        `${PRIOR_FAILED_COMPATIBILITY_REVISION}:bin/phase-b-refence-maintenance-contract.ts`,
      ],
      [
        "show",
        `${IMMEDIATE_FAILED_COMPATIBILITY_REVISION}:bin/phase-b-refence-maintenance-contract.ts`,
      ],
      [
        "show",
        `${AUTHORIZED_H0_TARGET_REVISION}:bin/phase-b-refence-maintenance-contract.ts`,
      ],
      [
        "ls-tree",
        "-z",
        "HEAD",
        "--",
        "bin/phase-b-refence-maintenance-contract.ts",
      ],
      [
        "ls-tree",
        "-z",
        IMMEDIATE_FAILED_COMPATIBILITY_REVISION,
        "--",
        "bin/phase-b-refence-maintenance-contract.ts",
      ],
      [
        "ls-tree",
        "-z",
        PRIOR_FAILED_COMPATIBILITY_REVISION,
        "--",
        "bin/phase-b-refence-maintenance-contract.ts",
      ],
    ] as const;
    for (const argv of exactProofCommands) {
      expect(refenceGitInvocationAllowedForTest(argv)).toBeTrue();
    }
    expect(refenceGitInvocationAllowedForTest([
      "ls-tree",
      "-rz",
      "--full-tree",
      AUTHORIZED_H0_TARGET_REVISION,
      "--",
      "api",
      "docs",
    ])).toBeTrue();
    for (
      const argv of [
        ["show", "head:bin/phase-b-refence-maintenance-contract.ts"],
        ["show", "HEAD:bin/phase-b-refence-maintenance-contract.ts", "--"],
        ["cat-file", "commit", "HEAD^"],
        ["cat-file", "commit", `${PRIOR_FAILED_COMPATIBILITY_REVISION}^`],
        ["rev-list", "--parents", "-n", "1", "HEAD"],
        ["rev-parse", "HEAD^3^{tree}"],
        ["rev-parse", `${revision("f")}^{tree}`],
        [
          "merge-base",
          "--is-ancestor",
          PRIOR_FAILED_COMPATIBILITY_REVISION,
          "HEAD^3",
        ],
        [
          "diff",
          "--raw",
          "-z",
          "--abbrev=40",
          "--no-renames",
          "--no-ext-diff",
          "--no-textconv",
          PRIOR_FAILED_COMPATIBILITY_REVISION,
          "HEAD^2",
          "--",
        ],
        [
          "diff",
          "--name-status",
          PRIOR_FAILED_COMPATIBILITY_REVISION,
          "HEAD",
          "--",
        ],
        [
          "show",
          `${revision("f")}:bin/phase-b-refence-maintenance-bridge.ts`,
        ],
        [
          "ls-tree",
          "-rz",
          "--full-tree",
          "HEAD",
          "--",
          "api",
          "docs",
        ],
        [
          "ls-tree",
          "-rz",
          "--full-tree",
          revision("a"),
          "--",
          "api",
          "docs",
        ],
        [
          "ls-tree",
          "HEAD",
          "--",
          "bin/phase-b-refence-maintenance-contract.ts",
        ],
        [
          "ls-tree",
          "-z",
          "HEAD",
          "bin/phase-b-refence-maintenance-contract.ts",
        ],
        [
          "ls-tree",
          "-z",
          "HEAD",
          "--",
          "./bin/phase-b-refence-maintenance-contract.ts",
        ],
      ]
    ) expect(refenceGitInvocationAllowedForTest(argv)).toBeFalse();
    const bridge = readFileSync(
      join(import.meta.dir, "..", "phase-b-refence-maintenance-bridge.ts"),
      "utf8",
    );
    const allowlist = bridge.slice(
      bridge.indexOf("function refenceGitInvocationAllowed("),
      bridge.indexOf(
        "/** @internal Exact Git read allowlist",
        bridge.indexOf(
          "function refenceGitInvocationAllowed(",
        ),
      ),
    );
    const directStart = bridge.indexOf("async function readProductionGitProof(");
    const directProof = bridge.slice(
      directStart,
      bridge.indexOf("function processProofFromBytes(", directStart),
    );
    const sharedStart = bridge.indexOf(
      "async function readCompatibilityGitProofWithRunner(",
    );
    const sharedProof = bridge.slice(
      sharedStart,
      bridge.indexOf(
        "function createJournalledControllerLocalReaders(",
        sharedStart,
      ),
    );
    const journalStart = bridge.indexOf(
      "  const runGit = async",
      bridge.indexOf("function createJournalledControllerLocalReaders("),
    );
    const journalProof = bridge.slice(
      journalStart,
      bridge.indexOf("  const runSecurity = async", journalStart),
    );
    const normalizeCommand = (value: string): string =>
      value.replace(/\s+/g, "").replace(/,\]/g, "]");
    const expectedSourceCommands = [
      '["config","--local","--null","--list"]',
      '["rev-parse","--git-common-dir"]',
      '["for-each-ref","--format=%(refname)","refs/replace/"]',
      '["rev-parse","HEAD"]',
      '["rev-parse",GITHUB_MAIN_TRACKING_REF]',
      '["rev-parse","HEAD^{tree}"]',
      '["rev-parse","HEAD^2^{tree}"]',
      '["rev-parse",AUTHORIZED_H0_TARGET_REVISION+"^{tree}"]',
      '["rev-parse",PRIOR_FAILED_COMPATIBILITY_REVISION+"^{tree}"]',
      '["rev-parse",PRIOR_FAILED_COMPATIBILITY_TOPIC_REVISION+"^{tree}"]',
      '["rev-parse",IMMEDIATE_FAILED_COMPATIBILITY_REVISION+"^{tree}"]',
      '["rev-parse",IMMEDIATE_FAILED_COMPATIBILITY_TOPIC_REVISION+"^{tree}"]',
      '["rev-list","--count",EXPECTED_SOURCE_REVISION+"..HEAD"]',
      '["rev-list","--count",EXPECTED_SOURCE_REVISION+".."+PRIOR_FAILED_COMPATIBILITY_REVISION]',
      '["rev-list","--count",EXPECTED_SOURCE_REVISION+".."+IMMEDIATE_FAILED_COMPATIBILITY_REVISION]',
      '["cat-file","commit","HEAD"]',
      '["cat-file","commit",PRIOR_FAILED_COMPATIBILITY_REVISION]',
      '["cat-file","commit",IMMEDIATE_FAILED_COMPATIBILITY_REVISION]',
      '["merge-base","--is-ancestor",EXPECTED_SOURCE_REVISION,"HEAD"]',
      '["merge-base","--is-ancestor",IMMEDIATE_FAILED_COMPATIBILITY_REVISION,"HEAD^2"]',
      '["status","--porcelain=v1","--untracked-files=all"]',
      '["diff","--raw","-z","--abbrev=40","--no-renames","--no-ext-diff","--no-textconv",AUTHORIZED_H0_TARGET_REVISION,PRIOR_FAILED_COMPATIBILITY_REVISION,"--"]',
      '["diff","--raw","-z","--abbrev=40","--no-renames","--no-ext-diff","--no-textconv",PRIOR_FAILED_COMPATIBILITY_REVISION,IMMEDIATE_FAILED_COMPATIBILITY_REVISION,"--"]',
      '["diff","--raw","-z","--abbrev=40","--no-renames","--no-ext-diff","--no-textconv",AUTHORIZED_H0_TARGET_REVISION,IMMEDIATE_FAILED_COMPATIBILITY_REVISION,"--"]',
      '["diff","--raw","-z","--abbrev=40","--no-renames","--no-ext-diff","--no-textconv",IMMEDIATE_FAILED_COMPATIBILITY_REVISION,"HEAD","--"]',
      '["diff","--raw","-z","--abbrev=40","--no-renames","--no-ext-diff","--no-textconv",AUTHORIZED_H0_TARGET_REVISION,"HEAD","--"]',
      '["show","HEAD:bin/phase-b-refence-maintenance-bridge.ts"]',
      '["show",PRIOR_FAILED_COMPATIBILITY_REVISION+":bin/phase-b-refence-maintenance-bridge.ts"]',
      '["show",IMMEDIATE_FAILED_COMPATIBILITY_REVISION+":bin/phase-b-refence-maintenance-bridge.ts"]',
      '["show",AUTHORIZED_H0_TARGET_REVISION+":bin/phase-b-refence-maintenance-bridge.ts"]',
      '["show","HEAD:bin/phase-b-refence-maintenance-contract.ts"]',
      '["show",PRIOR_FAILED_COMPATIBILITY_REVISION+":bin/phase-b-refence-maintenance-contract.ts"]',
      '["show",IMMEDIATE_FAILED_COMPATIBILITY_REVISION+":bin/phase-b-refence-maintenance-contract.ts"]',
      '["show",AUTHORIZED_H0_TARGET_REVISION+":bin/phase-b-refence-maintenance-contract.ts"]',
      '["ls-tree","-z","HEAD","--","bin/phase-b-refence-maintenance-contract.ts"]',
      '["ls-tree","-z",PRIOR_FAILED_COMPATIBILITY_REVISION,"--","bin/phase-b-refence-maintenance-contract.ts"]',
      '["ls-tree","-z",IMMEDIATE_FAILED_COMPATIBILITY_REVISION,"--","bin/phase-b-refence-maintenance-contract.ts"]',
      '["config","--local","--null","--list"]',
    ];
    const sharedCommands = [...sharedProof.matchAll(
      /runGit\(\s*"[^"]+",\s*(\[[^\]]+\])/g,
    )].map((match) => normalizeCommand(match[1]));
    expect(sharedCommands).toEqual(expectedSourceCommands);
    expect(directProof.match(/readCompatibilityGitProofWithRunner\(/g))
      .toHaveLength(1);
    expect(journalProof.match(/readCompatibilityGitProofWithRunner\(/g))
      .toHaveLength(1);
    expect(directProof).toContain(
      "runRefenceGitCLI(arguments_, MAX_PRIVATE_BYTES)",
    );
    expect(journalProof).toContain(
      'run({ suffix, effectKind: "read_git"',
    );
    expect([...sharedProof.matchAll(/runGit\(\s*"([^"]+)",\s*\[/g)]
      .map((match) => match[1])).toEqual([
      "local_config",
      "common_directory",
      "replacement_refs",
      "revision",
      "remote_revision",
      "tree",
      "topic_tree",
      "authorized_h0_tree",
      "prior_tree",
      "prior_topic_tree",
      "immediate_tree",
      "immediate_topic_tree",
      "distance",
      "prior_distance",
      "immediate_distance",
      "commit",
      "prior_commit",
      "immediate_commit",
      "ancestry",
      "topic_ancestry",
      "status",
      "prior_changed_paths",
      "immediate_changed_paths",
      "immediate_cumulative_changed_paths",
      "changed_paths",
      "cumulative_changed_paths",
      "bridge_source",
      "prior_bridge_source",
      "immediate_bridge_source",
      "authorized_h0_bridge_source",
      "contract_source",
      "prior_contract_source",
      "immediate_contract_source",
      "authorized_h0_contract_source",
      "contract_tree",
      "prior_contract_tree",
      "immediate_contract_tree",
      "local_config_rebound",
    ]);
    for (const command of expectedSourceCommands) {
      expect(normalizeCommand(allowlist)).toContain(command);
    }
    expect(bridge).toContain('"--no-replace-objects"');
    expect(bridge).toContain("GIT_NO_REPLACE_OBJECTS: \"1\"");
    expect(sharedProof.match(/validateGitLocalConfig\(/g)).toHaveLength(2);
  });

  test("Linux API gate typechecks bridge sources with only the installed compiler", () => {
    const preflight = readFileSync(
      join(import.meta.dir, "..", "preflight.sh"),
      "utf8",
    );
    const label = "Phase-B refence bridge typecheck (installed compiler only)";
    const start = preflight.indexOf(label);
    const end = preflight.indexOf("\n}", start);
    expect(start).toBeGreaterThan(0);
    const gate = preflight.slice(start, end);
    expect(gate).toContain("./node_modules/.bin/tsc");
    expect(gate).toContain("--noEmit --strict --skipLibCheck");
    expect(gate).toContain("../bin/phase-b-refence-maintenance-contract.ts");
    expect(gate).toContain("../bin/phase-b-refence-maintenance-bridge.ts");
    expect(gate).not.toMatch(/bunx|bun install|npm|npx|curl|network/);
    const workflow = readFileSync(
      join(import.meta.dir, "../..", ".github/workflows/ci.yml"),
      "utf8",
    );
    expect(workflow.indexOf("bin/prepare-hermetic-deps.sh api")).toBeLessThan(
      workflow.indexOf("bin/preflight.sh api"),
    );
  });

  test("pure Gregorian timestamp validation matches leap and fractional boundaries", () => {
    const contract = createMaintenanceContract({
      canonical: canonicalJson,
      digest: sha256,
      refuse: (code) => {
        throw new MaintenanceRefenceError(code);
      },
    });
    const evidence = guardFixture().evidence;
    const accepted = [
      "2000-02-29T23:59:59Z",
      ...Array.from(
        { length: 9 },
        (_, index) => `2028-02-29T00:00:00.${"1".repeat(index + 1)}Z`,
      ),
    ];
    expect(accepted).toHaveLength(10);
    for (const timestamp of accepted) {
      const fleet = structuredClone(stoppedFleet().fleet);
      fleet[0].updated_at = timestamp;
      expect(() => contract.validateStoppedFleet(fleet, evidence)).not
        .toThrow();
    }
    const refused = [
      "2001-02-29T00:00:00Z",
      "2026-00-01T00:00:00Z",
      "2026-13-01T00:00:00Z",
      "2026-04-31T00:00:00Z",
      "2026-01-00T00:00:00Z",
      "2026-01-01T24:00:00Z",
      "2026-01-01T00:60:00Z",
      "2026-01-01T00:00:60Z",
      "2026-01-01T00:00:00.Z",
      "2026-01-01T00:00:00.1234567890Z",
    ];
    for (const timestamp of refused) {
      const fleet = structuredClone(stoppedFleet().fleet);
      fleet[0].updated_at = timestamp;
      expectMaintenanceRefusalCode(() => {
        contract.validateStoppedFleet(fleet, evidence);
      }, "fleet_contract");
    }

    expectMaintenanceRefusalCode(() =>
      contract.validateControllerWalEntry(
        {
          schema: "agenttool-phase-b-refence-maintenance-child-wal/v1",
          ordinal: 1,
          prior_entry_sha256: null,
          controller_run_id: "01234567-89ab-cdef-0123-456789abcdef",
          rollout_id:
            "maintenance-refence-aaaaaaaaaaaa-20260825T120000Z-0123456789abcdef",
          receipt_sha256: digest("a"),
          recorded_at: "2026-02-30T00:00:00Z",
          phase: "ready",
          checkpoint: "controller_ready",
          effect_id: null,
          effect_kind: null,
          target: null,
          argv_sha256: null,
          pid: null,
          pgid: null,
          exit_code: null,
          termination: null,
          local_process_group_settled: true,
          provider_transition_sha256: null,
          fleet_readback_sha256: null,
          detail_sha256: digest("b"),
          failure_code: null,
        },
        null,
        [],
        {
          controllerRunID: "01234567-89ab-cdef-0123-456789abcdef",
          rolloutID:
            "maintenance-refence-aaaaaaaaaaaa-20260825T120000Z-0123456789abcdef",
          receiptSHA256: digest("a"),
        },
      ), "controller_wal_contract");
  });

  test("post-handoff guard children have no unjournalled launcher path", () => {
    const source = readFileSync(
      join(import.meta.dir, "..", "phase-b-refence-maintenance-bridge.ts"),
      "utf8",
    );
    const localStart = source.indexOf(
      "function createJournalledControllerLocalReaders(",
    );
    const guardStart = source.indexOf(
      "function createJournalledControllerGuardDependencies(",
      localStart,
    );
    const guardEnd = source.indexOf(
      "class ProductionFlySSHAgentLifecycle",
      guardStart,
    );
    expect(localStart).toBeGreaterThan(0);
    expect(guardStart).toBeGreaterThan(localStart);
    expect(guardEnd).toBeGreaterThan(guardStart);
    const localReaders = source.slice(localStart, guardStart);
    const guardDependencies = source.slice(guardStart, guardEnd);
    const forbiddenPostH = [
      "readBoundedChild(",
      "runRefenceFlyCLI(",
      "runRefenceGitCLI(",
      "runRefenceSecurityCLI(",
      "readProductionGitProof(",
      "readProductionProcessProof(",
      "readSettledDatabaseURLs(",
      "fetchLiteralGitHubMain(",
      "Bun.spawn(",
      "Bun.spawnSync(",
      "Deno.Command",
      "node:child_process",
    ];
    for (const body of [localReaders, guardDependencies]) {
      for (const token of forbiddenPostH) expect(body).not.toContain(token);
      expect(body).not.toMatch(/\bruntime\.(?:spawn|settle|takeStdout)\s*\(/);
    }
    expect(localReaders).toContain(
      "performControllerJournalledReadChildForTest({",
    );
    expect(guardDependencies).toContain(
      "performControllerJournalledProviderReadForTest({",
    );
    expect(guardDependencies).toContain(
      "createJournalledControllerLocalReaders(request)",
    );
    expect(guardDependencies).not.toContain("request.base.readGitProof");
    expect(guardDependencies).not.toContain("request.base.readKeychainProof");
    expect(guardDependencies).not.toContain("request.base.readProcessProof");
    expect(guardDependencies).not.toContain(
      "request.base.readProviderSecretInventory",
    );
    expect(guardDependencies).not.toContain("request.base.readFleetInventory");
    expect(
      [...guardDependencies.matchAll(/request\.base\.([A-Za-z0-9_]+)/g)]
        .map((match) => match[1]).sort(),
    ).toEqual([
      "close",
      "controllerPhase",
      "pause",
      "readDatabaseProof",
    ]);

    const range = (startToken: string, endToken: string): string => {
      const start = source.indexOf(startToken);
      const end = source.indexOf(endToken, start);
      expect(start).toBeGreaterThan(0);
      expect(end).toBeGreaterThan(start);
      return source.slice(start, end);
    };
    const legacyChild = range(
      "async function readBoundedChild(",
      "async function runRefenceFlyCLI(",
    );
    const flyRuntime = range(
      "class ProductionFlyEffectRuntime",
      "interface ProductionReadChildRecord",
    );
    const readRuntime = range(
      "class ProductionControllerReadEffectRuntime",
      "export interface ControllerReadEffectRuntime",
    );
    for (const body of [legacyChild, flyRuntime, readRuntime]) {
      expect(body.match(/\bBun\.spawn\(/g)).toHaveLength(1);
    }
    let outsideLaunchers = source;
    for (const body of [legacyChild, flyRuntime, readRuntime]) {
      outsideLaunchers = outsideLaunchers.replace(body, "");
    }
    expect(outsideLaunchers).not.toContain("Bun.spawn(");
    expect(source).not.toContain('Bun["spawn"]');
    expect(source).not.toContain("Bun.spawnSync");
    expect(source).not.toMatch(/=\s*Bun\.spawn\s*;/);
    expect(source).not.toContain("node:child_process");
    expect(source).not.toContain("Deno.Command");
    for (const runtimeBody of [flyRuntime, readRuntime]) {
      const spawnIndex = runtimeBody.indexOf("const child = Bun.spawn(");
      const activeOwnerIndex = runtimeBody.indexOf(
        "ownProductionChild(child);",
        spawnIndex,
      );
      const pidIndex = runtimeBody.indexOf(
        "const pid = Number(child.pid);",
        spawnIndex,
      );
      expect(spawnIndex).toBeGreaterThan(0);
      expect(activeOwnerIndex).toBeGreaterThan(spawnIndex);
      expect(pidIndex).toBeGreaterThan(activeOwnerIndex);
      expect(runtimeBody).toContain("settleBoundedProductionChild(");
      expect(runtimeBody).not.toContain(
        "await Promise.all([record.child.exited, output])",
      );
      expect(runtimeBody).not.toContain("await Promise.allSettled([output])");
    }
    const settlement = range(
      "async function settleBoundedProductionChild(",
      "async function readBoundedChild(",
    );
    expect(settlement).toContain("const owner = activeProductionChildPipes;");
    expect(settlement).toContain("const abort = owner.abort;");
    expect(settlement).toContain("releaseSettledProductionChild(child)");
    expect(settlement).toContain("settlePromiseWithin(");
    expect(settlement).not.toContain("await child.exited");
    expect(
      source.match(
        /if \(processGroupSettled && activeProductionChild === record\.child\)/g,
      ),
    ).toHaveLength(2);
    expect(
      source.match(/if \(processGroupSettled && interruptHardKill\)/g),
    ).toHaveLength(2);
    expect(source).not.toContain(
      "if (activeProductionChild === record.child) activeProductionChild = null;",
    );
    expect(source).toMatch(
      /evidence\.edge === "H0",\s*"production_dependencies_pre_handoff"/,
    );
    expect(source).toMatch(
      /request\.base\.controllerPhase === "post_handoff_childless"\s*&&\s*request\.evidence\.edge === "H5"/,
    );
    expect(source).toContain("sealChildLaunchersForHandoff: () => {");
    expect(source).toContain("childLaunchersSealed = true;");
    expect(source).toContain('"pre_handoff_child_authority"');
  });

  test("the production session seals children before H and journals ready after H5", () => {
    const source = readFileSync(
      join(import.meta.dir, "..", "phase-b-refence-maintenance-bridge.ts"),
      "utf8",
    );
    expect(Buffer.byteLength(source)).toBeLessThan(512 * 1024);
    const start = source.indexOf(
      "async function createProductionControllerSession(",
    );
    const end = source.indexOf(
      "export interface ControllerRecoveryDependencies",
      start,
    );
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const session = source.slice(start, end);
    const ordered = [
      "requireProductionControllerLaunchContract();",
      "const lock = acquireDeployLockForController();",
      "const ingress = readRefenceIngressTarget(arguments_.receiptSHA256);",
      "validateProcessProof(await readProductionProcessProof());",
      "await loadVerifiedMaintenanceContract();",
      "await fetchLiteralGitHubMain();",
      "const initialEvidence = classifyHandoff(",
      "const git = await readProductionGitProof(initialEvidence);",
      "await prepareProductionDependencyEstate(",
      "await prepareProductionBuildContext(initialEvidence);",
      "await createProductionDependencies(",
      "await runMaintenanceRefenceGuardForController({",
      "createPrivateDirectoryExclusive(CONTROLLER_WAL_ROOT, DEPLOY_STATE_DIR);",
      "preparedDependencies.sealChildLaunchersForHandoff();",
      "preparedDependencies = null;",
      "const handoff = completeHandoff(",
      "const adoptedEvidence = classifyHandoff(",
      "const wal = new ControllerWalWriter({",
      "state = new ProductionBridgeMarkerState({",
      "wal.append({",
      'state.advance("controller_ready");',
      "await runControllerDatabaseConvergenceCoreForTest({",
      "validateVerifiedDatabaseConvergenceForTest(",
      "createJournalledControllerGuardDependencies({",
      "createProductionFlyOperationAdapter({",
    ];
    let previous = -1;
    for (const token of ordered) {
      const index = session.indexOf(token, previous + 1);
      expect(index).toBeGreaterThan(previous);
      previous = index;
    }
    expect(session).not.toContain("releaseDeployLockForController(");
    expect(session).not.toContain("runRefenceFlyCLI(");
    expect(session).not.toContain("Bun.spawn(");
    const catchStart = session.indexOf("catch (error) {");
    expect(catchStart).toBeGreaterThan(0);
    const catchBody = session.slice(catchStart);
    const childSettle = catchBody.indexOf(
      "let cleanupUncertain = !await settleResourceTwice",
    );
    const databaseSettle = catchBody.indexOf("closeable.close()", childSettle);
    const retain = catchBody.indexOf(
      'state.retainManualFailure("controller_resource_cleanup_uncertain")',
      databaseSettle,
    );
    const descriptorClose = catchBody.indexOf(
      "closeRetainedDeployLockDescriptor(lock)",
      retain,
    );
    expect(childSettle).toBeGreaterThan(0);
    expect(databaseSettle).toBeGreaterThan(childSettle);
    expect(retain).toBeGreaterThan(databaseSettle);
    expect(descriptorClose).toBeGreaterThan(retain);
    expect(session).toContain("closeResources: resourceTeardown.close,");
    expect(session).toContain(
      "closeAuthority: () => closeRetainedDeployLockDescriptor(lock)",
    );
    const main = source.slice(source.indexOf("async function main():"));
    expect(main).not.toContain("createProductionControllerSession(");
    expect(main.match(/await runProductionController\(arguments_\);/g))
      .toHaveLength(1);
  });

  test("the production controller composes the one-shot owned graph", () => {
    const source = readFileSync(
      join(import.meta.dir, "..", "phase-b-refence-maintenance-bridge.ts"),
      "utf8",
    );
    const start = source.indexOf("async function runProductionController(");
    const end = source.indexOf(
      "export interface ControllerRolloutDependencies",
      start,
    );
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const body = source.slice(start, end);
    const ordered = [
      "return runOwnedControllerSessionForTest({",
      "createSession: () => createProductionControllerSession(arguments_),",
      "createDependencies: (session) =>",
      "createProductionRolloutDependencies(session),",
      "run: (session, dependencies) =>",
      "runControllerRolloutCore({",
      "evidence: session.evidence,",
      "rolloutID: session.rolloutID,",
      "dependencies,",
      "closeResources: (session) => session.closeResources(),",
      "closeAuthority: (session) => session.closeAuthority(),",
      "retainCleanupUncertainty: (session) =>",
      '"controller_resource_cleanup_uncertain",',
    ];
    let previous = -1;
    for (const token of ordered) {
      const index = body.indexOf(token, previous + 1);
      expect(index).toBeGreaterThan(previous);
      previous = index;
    }
    expect(body.match(/createProductionControllerSession\(/g)).toHaveLength(1);
    expect(body.match(/createProductionRolloutDependencies\(/g)).toHaveLength(
      1,
    );
    expect(body.match(/runControllerRolloutCore\(/g)).toHaveLength(1);
    expect(body).not.toMatch(/releaseDeployLockForController|Bun\.spawn/);
    const main = source.slice(source.indexOf("async function main():"));
    expect(main.match(/await runProductionController\(arguments_\);/g))
      .toHaveLength(1);
    expect(main).not.toContain("controller_not_activated");
  });

  test("owned session teardown preserves the primary failure and marks uncertainty", async () => {
    const original = new Error("original_rollout_failure");
    const calls: string[] = [];
    const session = { id: "session" };
    await expect(runOwnedControllerSessionForTest({
      createSession: async () => {
        calls.push("session");
        return session;
      },
      createDependencies: (value) => {
        expect(value).toBe(session);
        calls.push("dependencies");
        return { id: "dependencies" };
      },
      run: async (value, dependencies) => {
        expect(value).toBe(session);
        expect(dependencies.id).toBe("dependencies");
        calls.push("run");
        throw original;
      },
      closeResources: async (value) => {
        expect(value).toBe(session);
        calls.push("close");
        throw new Error("cleanup_uncertain");
      },
      closeAuthority: (value) => {
        expect(value).toBe(session);
        calls.push("authority");
        return true;
      },
      retainCleanupUncertainty: (value) => {
        expect(value).toBe(session);
        calls.push("retain");
      },
    })).rejects.toBe(original);
    expect(calls).toEqual([
      "session",
      "dependencies",
      "run",
      "close",
      "close",
      "retain",
      "authority",
    ]);

    const retryOriginal = new Error("retry_original");
    let retryCloses = 0;
    let retryRetains = 0;
    await expect(runOwnedControllerSessionForTest({
      createSession: async () => session,
      createDependencies: () => {
        throw retryOriginal;
      },
      run: async () => {
        throw new Error("unreachable");
      },
      closeResources: async () => {
        retryCloses += 1;
        if (retryCloses === 1) throw new Error("first_close");
      },
      closeAuthority: () => true,
      retainCleanupUncertainty: () => {
        retryRetains += 1;
      },
    })).rejects.toBe(retryOriginal);
    expect(retryCloses).toBe(2);
    expect(retryRetains).toBe(0);

    let closes = 0;
    const result = await runOwnedControllerSessionForTest({
      createSession: async () => session,
      createDependencies: () => "dependencies",
      run: async () => "complete",
      closeResources: async () => {
        closes += 1;
      },
      closeAuthority: () => true,
      retainCleanupUncertainty: () => {
        throw new Error("must not retain");
      },
    });
    expect(result).toBe("complete");
    expect(closes).toBe(1);

    const authorityCalls: string[] = [];
    await expect(runOwnedControllerSessionForTest({
      createSession: async () => session,
      createDependencies: () => "dependencies",
      run: async () => {
        throw original;
      },
      closeResources: async () => {
        authorityCalls.push("resources");
        throw new Error("resource_uncertain");
      },
      closeAuthority: () => {
        authorityCalls.push("authority");
        return true;
      },
      retainCleanupUncertainty: () => authorityCalls.push("retain"),
    })).rejects.toBe(original);
    expect(authorityCalls).toEqual([
      "resources",
      "resources",
      "retain",
      "authority",
    ]);
  });

  test("database registry retains uncertainty, force-closes, retries, and seals", async () => {
    const registry = createDatabaseClientRegistryForTest(5);
    const calls: string[] = [];
    let retryThird = false;
    const client = (name: string, behavior: (timeout: number) => unknown) => ({
      end: ({ timeout }: { timeout: number }) => {
        calls.push(`${name}:${timeout}`);
        return behavior(timeout);
      },
    });
    registry.register(client("first", () => Promise.resolve()));
    registry.register(
      client(
        "second",
        (timeout) =>
          timeout === 2
            ? Promise.reject(new Error("normal"))
            : Promise.resolve(),
      ),
    );
    registry.register(
      client(
        "third",
        () => retryThird ? Promise.resolve() : new Promise(() => {}),
      ),
    );
    await expect(registry.closeAll()).rejects.toThrow("database_close");
    expect(calls).toEqual([
      "first:2",
      "second:2",
      "third:2",
      "second:0",
      "third:0",
    ]);
    expect(registry.activeCount()).toBe(1);
    retryThird = true;
    await expect(registry.closeAll()).resolves.toBeUndefined();
    expect(registry.activeCount()).toBe(0);
    await expect(registry.closeAll()).resolves.toBeUndefined();
    expect(() => registry.register(client("late", () => Promise.resolve())))
      .toThrow("database_client_registry");
  });

  test("session teardown attempts child and database settlement on every retry", async () => {
    let boundedAttempts = 0;
    expect(
      await settleResourceTwiceForTest(async () => {
        boundedAttempts += 1;
        return false;
      }),
    ).toBeFalse();
    expect(boundedAttempts).toBe(2);
    boundedAttempts = 0;
    expect(
      await settleResourceTwiceForTest(async () => {
        boundedAttempts += 1;
        return boundedAttempts === 2;
      }),
    ).toBeTrue();
    expect(boundedAttempts).toBe(2);

    const calls: string[] = [];
    let retry = false;
    const teardown = createSessionResourceTeardownForTest({
      settleActiveChild: async () => {
        calls.push("child");
        return retry;
      },
      closeDatabaseClients: async () => {
        calls.push("database");
        if (!retry) throw new Error("database");
      },
    });
    await expect(teardown.close()).rejects.toThrow(
      "controller_resource_cleanup_uncertain",
    );
    expect(calls).toEqual(["child", "database"]);
    expect(teardown.complete()).toBeFalse();
    retry = true;
    await expect(teardown.close()).resolves.toBeUndefined();
    await expect(teardown.close()).resolves.toBeUndefined();
    expect(calls).toEqual(["child", "database", "child", "database"]);
    expect(teardown.complete()).toBeTrue();
  });

  test("active child ownership starts both pipe readers and settles both on cancellation", async () => {
    const cancellations = [0, 0];
    const pending = (index: number) =>
      new ReadableStream<Uint8Array>({
        cancel: () => {
          cancellations[index] += 1;
        },
      });
    const owner = createProductionChildPipeOwnerForTest({
      stdout: pending(0),
      stderr: pending(1),
    }, 64);
    owner.abort.abort();
    expect(await Promise.all(owner.streams)).toEqual([
      { fulfilled: true, resourceSettled: true, value: new Uint8Array() },
      { fulfilled: true, resourceSettled: true, value: new Uint8Array() },
    ]);
    expect(cancellations).toEqual([1, 1]);

    const failed = createProductionChildPipeOwnerForTest({
      stdout: new ReadableStream<Uint8Array>({
        start: (controller) => controller.error(new Error("stdout")),
      }),
      stderr: pending(1),
    }, 64);
    failed.abort.abort();
    expect(await Promise.all(failed.streams)).toEqual([
      { fulfilled: false, resourceSettled: false },
      { fulfilled: true, resourceSettled: true, value: new Uint8Array() },
    ]);
    expect(cancellations).toEqual([1, 2]);

    const releases: Array<() => void> = [];
    const delayed = () =>
      new ReadableStream<Uint8Array>({
        cancel: () => new Promise<void>((resolve) => releases.push(resolve)),
      });
    const pendingOwner = createProductionChildPipeOwnerForTest({
      stdout: delayed(),
      stderr: delayed(),
    }, 64);
    pendingOwner.abort.abort();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(releases).toHaveLength(2);
    let pendingSettled = false;
    void Promise.all(pendingOwner.streams).then(() => pendingSettled = true);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(pendingSettled).toBeFalse();
    releases.forEach((resolve) => resolve());
    expect(await Promise.all(pendingOwner.streams)).toEqual([
      { fulfilled: true, resourceSettled: true, value: new Uint8Array() },
      { fulfilled: true, resourceSettled: true, value: new Uint8Array() },
    ]);

    const rejected = createProductionChildPipeOwnerForTest({
      stdout: new ReadableStream<Uint8Array>({
        cancel: () => Promise.reject(new Error("stdout_cancel")),
      }),
      stderr: new ReadableStream<Uint8Array>({
        cancel: () => Promise.reject(new Error("stderr_cancel")),
      }),
    }, 64);
    rejected.abort.abort();
    expect(await Promise.all(rejected.streams)).toEqual([
      { fulfilled: false, resourceSettled: false },
      { fulfilled: false, resourceSettled: false },
    ]);

    const source = readFileSync(
      join(import.meta.dir, "..", "phase-b-refence-maintenance-bridge.ts"),
      "utf8",
    );
    const start = source.indexOf("async function readBoundedChild(");
    const end = source.indexOf("async function runRefenceFlyCLI(", start);
    const reader = source.slice(start, end);
    expect(reader).toContain("ownProductionChild(child, maximum);");
    expect(reader).toContain("await settleOwnedProductionChild(child)");
    expect(reader).toContain("await releaseSettledProductionChild(child)");
    expect(reader).not.toContain("activeProductionChild = null");
  });

  test("production success composition seals evidence before the shared A0 ceremony", () => {
    const source = readFileSync(
      join(import.meta.dir, "..", "phase-b-refence-maintenance-bridge.ts"),
      "utf8",
    );
    const start = source.indexOf(
      "async function finalizeProductionControllerSuccess(",
    );
    const end = source.indexOf(
      "function createProductionRolloutDependencies(",
      start,
    );
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const body = source.slice(start, end);
    const ordered = [
      "session.state.verifyLocalAuthority();",
      "session.flyAgentLifecycle.requireSuccessProofs(",
      "requireCondition(rolloutProofs.final_absence_sha256 === null",
      "rolloutProofs.final_absence_sha256 = await session.flyAgentLifecycle.proveFinalizationAbsence(",
      "const rolloutProofSHA256 = sha256(canonicalJson(rolloutProofs));",
      "session.state.closeEffects();",
      "lifecycle.effectsClosed();",
      "session.state.wal.sealComplete(",
      "session.state.bindSealedWal(successProvenAt, walProjection);",
      "await session.closeForFinalization();",
      "const marker = session.state.successAuthorityMarker();",
      "final_absence_sha256: session.flyAgentLifecycle.finalAbsenceSHA256,",
      "maintenanceContract().createSuccessAuthorityProjection(",
      "session.state.previewSuccessFinalization(previewRequest);",
      "maintenanceContract().createSuccessArtifacts({",
      "return performSuccessFinalizationCeremony({",
      "session.state.beginSuccessFinalization(",
      "lifecycle.a0Installed,",
      "maintenanceContract().validateSuccessArtifactBundle(artifacts);",
    ];
    let previous = -1;
    for (const token of ordered) {
      const index = body.indexOf(token, previous + 1);
      expect(index).toBeGreaterThan(previous);
      previous = index;
    }
    expect(body).not.toMatch(
      /Bun\.spawn|runRefenceFlyCLI|readProductionKeychain|fetch\(|sql\./,
    );
    const closeEffects = source.slice(
      source.indexOf("  closeEffects(): void {"),
      source.indexOf(
        "  bindSealedWal(",
        source.indexOf("  closeEffects(): void {"),
      ),
    );
    expect(closeEffects.indexOf("activeProductionChild === null")).toBeLessThan(
      closeEffects.indexOf("this.#effectsClosed = true;"),
    );
    const bindWal = source.slice(
      source.indexOf("  bindSealedWal("),
      source.indexOf(
        "  successAuthorityMarker():",
        source.indexOf("  bindSealedWal("),
      ),
    );
    expect(bindWal).toContain("this.#effectsClosed && this.wal.sealed");
    expect(source).toContain(
      'if (this.#reconcileTransition(next, nextSHA256) === "next") {',
    );
    const dependencies = source.slice(
      end,
      source.indexOf(
        "export interface ControllerRolloutDependencies",
        end,
      ),
    );
    expect(dependencies).toContain(
      "finalizeProductionControllerSuccess(session, proofs, lifecycle)",
    );
    const main = source.slice(source.indexOf("async function main():"));
    expect(main).not.toContain("createProductionRolloutDependencies(");
    expect(main.match(/await runProductionController\(arguments_\);/g))
      .toHaveLength(1);
  });

  test("controller owns one durable hardlink lock through exact release", () => {
    const directory = realpathSync(
      mkdtempSync(join(tmpdir(), "refence-lock-")),
    );
    temporaryDirectories.push(directory);
    chmodSync(directory, 0o700);
    const paths = {
      directory,
      publicPath: join(directory, "deploy.lock"),
      worktree: directory,
    };
    const authority = acquireDeployLockForController(
      paths,
      new Date("2026-08-25T12:00:00Z"),
    );
    expect(lstatSync(paths.publicPath).nlink).toBe(2);
    expect(lstatSync(authority.ownerPath).ino).toBe(
      lstatSync(paths.publicPath).ino,
    );
    expect(() => acquireDeployLockForController(paths)).toThrow(
      MaintenanceRefenceError,
    );
    releaseDeployLockForController(authority, paths);
    expect(authority.phase).toBe("released");
    expect(existsSync(paths.publicPath)).toBe(false);
    expect(existsSync(authority.ownerPath)).toBe(false);
  });

  test("terminal teardown closes only the retained lock descriptor in every phase", () => {
    const acquire = (suffix: string) => {
      const directory = realpathSync(
        mkdtempSync(join(tmpdir(), `refence-lock-close-${suffix}-`)),
      );
      temporaryDirectories.push(directory);
      chmodSync(directory, 0o700);
      const paths = {
        directory,
        publicPath: join(directory, "deploy.lock"),
        worktree: directory,
      };
      return { paths, authority: acquireDeployLockForController(paths) };
    };

    const held = acquire("held");
    const heldInode = lstatSync(held.paths.publicPath).ino;
    expect(closeRetainedDeployLockDescriptorForTest(held.authority)).toBeTrue();
    expect(() => fstatSync(held.authority.descriptor)).toThrow();
    expect(lstatSync(held.paths.publicPath).ino).toBe(heldInode);
    expect(lstatSync(held.authority.ownerPath).ino).toBe(heldInode);
    expect(lstatSync(held.paths.publicPath).nlink).toBe(2);

    const partial = acquire("partial");
    releaseDeployLockPublicForController(partial.authority, partial.paths);
    expect(partial.authority.phase).toBe("public_unlinked");
    expect(closeRetainedDeployLockDescriptorForTest(partial.authority))
      .toBeTrue();
    expect(() => fstatSync(partial.authority.descriptor)).toThrow();
    expect(existsSync(partial.paths.publicPath)).toBeFalse();
    expect(lstatSync(partial.authority.ownerPath).nlink).toBe(1);

    const released = acquire("released");
    releaseDeployLockForController(released.authority, released.paths);
    expect(closeRetainedDeployLockDescriptorForTest(released.authority))
      .toBeTrue();
    expect(() => fstatSync(released.authority.descriptor)).toThrow();
    expect(existsSync(released.paths.publicPath)).toBeFalse();
    expect(existsSync(released.authority.ownerPath)).toBeFalse();

    const drifted = acquire("drifted");
    unlinkSync(drifted.paths.publicPath);
    expect(drifted.authority.phase).toBe("held");
    expect(closeRetainedDeployLockDescriptorForTest(drifted.authority))
      .toBeTrue();
    expect(() => fstatSync(drifted.authority.descriptor)).toThrow();
    expect(lstatSync(drifted.authority.ownerPath).nlink).toBe(1);

    const unlinked = acquire("unlinked");
    unlinkSync(unlinked.paths.publicPath);
    unlinkSync(unlinked.authority.ownerPath);
    expect(unlinked.authority.phase).toBe("held");
    expect(closeRetainedDeployLockDescriptorForTest(unlinked.authority))
      .toBeTrue();
    expect(() => fstatSync(unlinked.authority.descriptor)).toThrow();
    expect(existsSync(unlinked.paths.publicPath)).toBeFalse();
    expect(existsSync(unlinked.authority.ownerPath)).toBeFalse();
  });

  test("controller refuses to release a substituted public lock", () => {
    const directory = realpathSync(
      mkdtempSync(join(tmpdir(), "refence-lock-race-")),
    );
    temporaryDirectories.push(directory);
    chmodSync(directory, 0o700);
    const paths = {
      directory,
      publicPath: join(directory, "deploy.lock"),
      worktree: directory,
    };
    const authority = acquireDeployLockForController(paths);
    unlinkSync(paths.publicPath);
    writeFileSync(paths.publicPath, authority.recordBytes, { mode: 0o600 });
    expect(() => releaseDeployLockForController(authority, paths)).toThrow(
      MaintenanceRefenceError,
    );
    expect(authority.phase).toBe("held");
    expect(existsSync(authority.ownerPath)).toBe(true);
    expect(closeRetainedDeployLockDescriptorForTest(authority)).toBeTrue();
    expect(() => fstatSync(authority.descriptor)).toThrow();
    expect(existsSync(paths.publicPath)).toBeTrue();
    expect(lstatSync(authority.ownerPath).nlink).toBe(1);
  });

  test("provider effects are intent-first and whole-group-settled in the WAL", async () => {
    const directory = realpathSync(
      mkdtempSync(join(tmpdir(), "refence-effect-wal-")),
    );
    temporaryDirectories.push(directory);
    chmodSync(directory, 0o700);
    const wal = new ControllerWalWriter({
      directory,
      controllerRunID: "01234567-89ab-cdef-0123-456789abcdef",
      rolloutID:
        "maintenance-refence-d87a3f35c80b-20260825T120000Z-0123456789abcdef",
      receiptSHA256: digest("a"),
    });
    const times = [
      "2026-08-25T12:00:00Z",
      "2026-08-25T12:00:01Z",
      "2026-08-25T12:00:02Z",
      "2026-08-25T12:00:03Z",
      "2026-08-25T12:00:04Z",
    ];
    wal.append({
      recorded_at: times.shift()!,
      phase: "ready",
      checkpoint: "effects_ready",
      effect_id: null,
      effect_kind: null,
      target: null,
      argv_sha256: null,
      pid: null,
      pgid: null,
      exit_code: null,
      termination: null,
      local_process_group_settled: true,
      provider_transition_sha256: null,
      fleet_readback_sha256: null,
      detail_sha256: digest("b"),
      failure_code: null,
    });
    const phases: string[] = [];
    await executeControllerEffect({
      wal,
      runtime: {
        now: () => times.shift()!,
        spawn: () => {
          phases.push(wal.lastEntry!.phase);
          return { pid: 4242, pgid: 4242 };
        },
        settle: async () => ({
          exitCode: 0,
          termination: "exit",
          processGroupSettled: true,
          detailSHA256: digest("c"),
        }),
      },
      effectID: "update_primary_image",
      effectKind: "update_image",
      checkpoint: "primary_image",
      target: "e829421fd1e628",
      argv: ["fly", "machine", "update", "e829421fd1e628"],
      timeoutMilliseconds: 360_000,
      verify: async () => ({
        providerTransitionSHA256: digest("d"),
        fleetReadbackSHA256: digest("e"),
        detailSHA256: digest("f"),
      }),
    });
    expect(phases).toEqual(["attempting"]);
    expect(wal.projection().entry_count).toBe(5);
    expect(wal.projection().terminal_phase).toBe("verified");
    expect(readdirSync(directory)).toHaveLength(5);
  });

  test("post-handoff provider reads are WAL-bound without raw secret names", async () => {
    const directory = realpathSync(
      mkdtempSync(join(tmpdir(), "refence-provider-read-wal-")),
    );
    temporaryDirectories.push(directory);
    chmodSync(directory, 0o700);
    const wal = new ControllerWalWriter({
      directory,
      controllerRunID: "01234567-89ab-cdef-0123-456789abcdef",
      rolloutID:
        "maintenance-refence-aaaaaaaaaaaa-20260825T120000Z-0123456789abcdef",
      receiptSHA256: digest("a"),
    });
    let tick = 0;
    let armed: ControllerFlyOperation | null = null;
    const outputByPID = new Map<number, Uint8Array>();
    wal.append({
      recorded_at: "2026-08-25T12:03:00Z",
      phase: "ready",
      checkpoint: "effects_ready",
      effect_id: null,
      effect_kind: null,
      target: null,
      argv_sha256: null,
      pid: null,
      pgid: null,
      exit_code: null,
      termination: null,
      local_process_group_settled: true,
      provider_transition_sha256: null,
      fleet_readback_sha256: null,
      detail_sha256: digest("b"),
      failure_code: null,
    });
    const result = await performControllerJournalledProviderReadForTest({
      wal,
      runtime: {
        now: () => "2026-08-25T12:03:" + String(++tick).padStart(2, "0") + "Z",
        arm: (operation) => {
          armed = operation;
          return controllerFlyArgv(operation);
        },
        spawn: () => {
          expect(armed?.kind).toBe("secrets");
          const child = { pid: 4545, pgid: 4545 };
          outputByPID.set(
            child.pid,
            new TextEncoder().encode(JSON.stringify([
              { Digest: digest("c"), Name: "SAFE_PROVIDER_NAME" },
            ])),
          );
          armed = null;
          return child;
        },
        settle: async () => ({
          exitCode: 0,
          termination: "exit",
          processGroupSettled: true,
          detailSHA256: digest("d"),
        }),
        takeStdout: (identity) => outputByPID.get(identity.pid)!,
      },
      operation: { kind: "secrets" },
      effectID: "guard_000001_secrets",
      checkpoint: "guard_provider_secrets",
      target: "agenttool",
      semanticProjection: (value) => value,
    });
    expect(result.value).toEqual([
      { Digest: digest("c"), Name: "SAFE_PROVIDER_NAME" },
    ]);
    expect(wal.projection().terminal_phase).toBe("verified");
    const durableWal = readdirSync(directory).sort().map((filename) =>
      readFileSync(join(directory, filename), "utf8")
    ).join("");
    expect(durableWal).not.toContain("SAFE_PROVIDER_NAME");
    expect(durableWal).not.toContain(digest("c"));
  });

  test("journalled Keychain absence treats exact exit 44 as verified evidence", async () => {
    const directory = realpathSync(
      mkdtempSync(join(tmpdir(), "refence-keychain-read-wal-")),
    );
    temporaryDirectories.push(directory);
    chmodSync(directory, 0o700);
    const wal = new ControllerWalWriter({
      directory,
      controllerRunID: "01234567-89ab-cdef-0123-456789abcdef",
      rolloutID:
        "maintenance-refence-aaaaaaaaaaaa-20260825T120000Z-0123456789abcdef",
      receiptSHA256: digest("a"),
    });
    let tick = 0;
    wal.append({
      recorded_at: "2026-08-25T12:04:00Z",
      phase: "ready",
      checkpoint: "effects_ready",
      effect_id: null,
      effect_kind: null,
      target: null,
      argv_sha256: null,
      pid: null,
      pgid: null,
      exit_code: null,
      termination: null,
      local_process_group_settled: true,
      provider_transition_sha256: null,
      fleet_readback_sha256: null,
      detail_sha256: digest("b"),
      failure_code: null,
    });
    const result = await performControllerJournalledReadChildForTest({
      wal,
      runtime: {
        now: () => "2026-08-25T12:04:" + String(++tick).padStart(2, "0") + "Z",
        spawn: () => ({ pid: 4646, pgid: 4646 }),
        settle: async () => ({
          exitCode: 44,
          termination: "exit",
          processGroupSettled: true,
          detailSHA256: digest("c"),
        }),
        takeStdout: () => new Uint8Array(),
      },
      effectID: "guard_000001_keychain_absence",
      effectKind: "read_keychain",
      checkpoint: "guard_keychain_absence",
      target: "generation_service",
      argv: ["/usr/bin/security", "find-generic-password"],
      timeoutMilliseconds: 30_000,
      acceptedExitCodes: [44],
      validate: (stdout, exitCode) => {
        expect(stdout.byteLength).toBe(0);
        expect(exitCode).toBe(44);
        return {
          value: { generation_absent: true as const },
          semanticProjection: { generation_absent: true },
        };
      },
    });
    expect(result.value.generation_absent).toBeTrue();
    expect(wal.lastEntry?.phase).toBe("verified");
    expect(wal.lastEntry?.exit_code).toBe(44);
  });

  test("a settled read refusal is recoverable but an unsettled read is manual", async () => {
    for (const mode of ["exit", "semantic", "timeout"] as const) {
      const directory = realpathSync(
        mkdtempSync(join(tmpdir(), `refence-read-${mode}-`)),
      );
      temporaryDirectories.push(directory);
      chmodSync(directory, 0o700);
      const wal = new ControllerWalWriter({
        directory,
        controllerRunID: "01234567-89ab-cdef-0123-456789abcdef",
        rolloutID:
          "maintenance-refence-aaaaaaaaaaaa-20260825T120000Z-0123456789abcdef",
        receiptSHA256: digest("a"),
      });
      let tick = 0;
      wal.append({
        recorded_at: "2026-08-25T12:04:00Z",
        phase: "ready",
        checkpoint: "effects_ready",
        effect_id: null,
        effect_kind: null,
        target: null,
        argv_sha256: null,
        pid: null,
        pgid: null,
        exit_code: null,
        termination: null,
        local_process_group_settled: true,
        provider_transition_sha256: null,
        fleet_readback_sha256: null,
        detail_sha256: digest("b"),
        failure_code: null,
      });
      const promise = performControllerJournalledReadChildForTest({
        wal,
        runtime: {
          now: () => `2026-08-25T12:04:${String(++tick).padStart(2, "0")}Z`,
          spawn: () => ({ pid: 4700 + tick, pgid: 4700 + tick }),
          settle: async (identity) => ({
            exitCode: mode === "exit" ? 1 : mode === "timeout" ? null : 0,
            termination: mode === "timeout" ? "timeout" : "exit",
            processGroupSettled: true,
            detailSHA256: digest("c"),
          }),
          takeStdout: () => new TextEncoder().encode("{}\n"),
        },
        effectID: `public_000001_${mode}`,
        effectKind: "public_probe",
        checkpoint: "first_canary_health_0",
        target: "health",
        argv: ["/pinned/bun", "-e", "closed"],
        timeoutMilliseconds: 60_000,
        acceptedExitCodes: [0],
        validate: () => {
          if (mode === "semantic") {
            throw new MaintenanceRefenceError("public_health_contract");
          }
          return { value: true, semanticProjection: { verified: true } };
        },
      });
      if (mode === "timeout") {
        await expect(promise).rejects.toBeInstanceOf(
          ControllerManualInterventionError,
        );
      } else {
        await expect(promise).rejects.toBeInstanceOf(
          ControllerSettledObservationError,
        );
      }
      expect(wal.lastEntry).toMatchObject({
        phase: "failed_or_uncertain",
        local_process_group_settled: true,
      });
    }
  });

  test("a timed-out mutator is terminal failed_or_uncertain", async () => {
    const directory = realpathSync(
      mkdtempSync(join(tmpdir(), "refence-effect-timeout-")),
    );
    temporaryDirectories.push(directory);
    chmodSync(directory, 0o700);
    const wal = new ControllerWalWriter({
      directory,
      controllerRunID: "01234567-89ab-cdef-0123-456789abcdef",
      rolloutID:
        "maintenance-refence-aaaaaaaaaaaa-20260825T120000Z-0123456789abcdef",
      receiptSHA256: digest("a"),
    });
    wal.append({
      recorded_at: "2026-08-25T12:00:00Z",
      phase: "ready",
      checkpoint: "effects_ready",
      effect_id: null,
      effect_kind: null,
      target: null,
      argv_sha256: null,
      pid: null,
      pgid: null,
      exit_code: null,
      termination: null,
      local_process_group_settled: true,
      provider_transition_sha256: null,
      fleet_readback_sha256: null,
      detail_sha256: digest("b"),
      failure_code: null,
    });
    let tick = 0;
    await expect(executeControllerEffect({
      wal,
      runtime: {
        now: () => `2026-08-25T12:00:0${++tick}Z`,
        spawn: () => ({ pid: 4343, pgid: 4343 }),
        settle: async () => ({
          exitCode: null,
          termination: "timeout",
          processGroupSettled: true,
          detailSHA256: digest("c"),
        }),
      },
      effectID: "uncordon_first_canary",
      effectKind: "uncordon_machine",
      checkpoint: "first_canary",
      target: "8606e9ae201e98",
      argv: ["fly", "machine", "uncordon", "8606e9ae201e98"],
      timeoutMilliseconds: 120_000,
      verify: async () => {
        throw new Error("must not verify");
      },
    })).rejects.toThrow("controller_child_uncertain");
    expect(wal.projection().terminal_phase).toBe("failed_or_uncertain");
    expect(wal.lastEntry!.termination).toBe("timeout");
    expect(wal.lastEntry!.local_process_group_settled).toBe(true);
  });

  test("a mutator advances only after two independently journaled fleet reads", async () => {
    const directory = realpathSync(
      mkdtempSync(join(tmpdir(), "refence-effect-readback-")),
    );
    temporaryDirectories.push(directory);
    chmodSync(directory, 0o700);
    const wal = new ControllerWalWriter({
      directory,
      controllerRunID: "01234567-89ab-cdef-0123-456789abcdef",
      rolloutID:
        "maintenance-refence-aaaaaaaaaaaa-20260825T120000Z-0123456789abcdef",
      receiptSHA256: digest("a"),
    });
    let second = 0;
    let pid = 5000;
    const runtime = {
      now: () => `2026-08-25T12:00:${String(second++).padStart(2, "0")}Z`,
      spawn: () => ({ pid: ++pid, pgid: pid }),
      settle: async () => ({
        exitCode: 0,
        termination: "exit" as const,
        processGroupSettled: true,
        detailSHA256: digest("b"),
      }),
    };
    wal.append({
      recorded_at: runtime.now(),
      phase: "ready",
      checkpoint: "effects_ready",
      effect_id: null,
      effect_kind: null,
      target: null,
      argv_sha256: null,
      pid: null,
      pgid: null,
      exit_code: null,
      termination: null,
      local_process_group_settled: true,
      provider_transition_sha256: null,
      fleet_readback_sha256: null,
      detail_sha256: digest("c"),
      failure_code: null,
    });
    await executeControllerEffectToSettlement({
      wal,
      runtime,
      effectID: "update_primary_image",
      effectKind: "update_image",
      checkpoint: "primary_image",
      target: "e829421fd1e628",
      argv: ["fly", "machine", "update", "e829421fd1e628"],
      timeoutMilliseconds: 360_000,
    });
    for (const sample of [1, 2]) {
      await executeControllerEffect({
        wal,
        runtime,
        effectID: `primary_image_read_${sample}`,
        effectKind: "read_fleet",
        checkpoint: `primary_image_read_${sample}`,
        target: "agenttool",
        argv: ["fly", "machine", "list", "-a", "agenttool", "--json"],
        timeoutMilliseconds: 120_000,
        verify: async () => ({
          providerTransitionSHA256: digest(String(sample + 1)),
          fleetReadbackSHA256: digest("9"),
          detailSHA256: digest(String(sample + 5)),
        }),
      });
    }
    appendControllerTransitionVerification({
      wal,
      effectID: "update_primary_image",
      recordedAt: runtime.now(),
      providerTransitionSHA256: digest("8"),
      fleetReadbackSHA256: digest("9"),
      detailSHA256: digest("a"),
    });
    expect(wal.lastEntry?.phase).toBe("transition_verified");
    expect(wal.projection().entry_count).toBe(13);
    expect(wal.projection().terminal_phase).toBe("transition_verified");
  });

  test("marker replacement is an exact durable same-inode CAS", () => {
    const directory = realpathSync(
      mkdtempSync(join(tmpdir(), "refence-marker-cas-")),
    );
    temporaryDirectories.push(directory);
    chmodSync(directory, 0o700);
    const canonicalPath = join(directory, "maintenance-active.json");
    const stagePath = join(directory, ".maintenance-next.tmp");
    const current = { checkpoint: "old", schema: "synthetic/v1" };
    const next = { checkpoint: "new", schema: "synthetic/v1" };
    const currentBytes = `${canonicalJson(current)}\n`;
    writeFileSync(canonicalPath, currentBytes, { mode: 0o600 });
    chmodSync(canonicalPath, 0o600);
    let authorityChecks = 0;
    const result = replaceDurableCanonicalJsonCAS({
      canonicalPath,
      directory,
      stagePath,
      expectedCurrentSHA256: sha256(currentBytes),
      nextValue: next,
      verifyAuthority: () => {
        authorityChecks += 1;
      },
      validateCurrent: (value) => expect(value).toEqual(current),
      validateNext: (value) => expect(value).toEqual(next),
    });
    expect(readFileSync(canonicalPath, "utf8")).toBe(
      `${canonicalJson(next)}\n`,
    );
    expect(result.sha256).toBe(sha256(`${canonicalJson(next)}\n`));
    expect(existsSync(stagePath)).toBe(false);
    expect(authorityChecks).toBe(4);
  });

  test("A0 signals after directory durability and before post-install validation", () => {
    const directory = realpathSync(
      mkdtempSync(join(tmpdir(), "refence-marker-a0-")),
    );
    temporaryDirectories.push(directory);
    chmodSync(directory, 0o700);
    const canonicalPath = join(directory, "maintenance-active.json");
    const stagePath = join(directory, ".maintenance-next.tmp");
    const current = { checkpoint: "old", schema: "synthetic/v1" };
    const next = { checkpoint: "new", schema: "synthetic/v1" };
    const currentBytes = `${canonicalJson(current)}\n`;
    writeFileSync(canonicalPath, currentBytes, { mode: 0o600 });
    chmodSync(canonicalPath, 0o600);
    let validations = 0;
    let installed = false;
    let visibleAtInstall = "";
    let caught: unknown = null;
    const failure = new Error("post_install_validation");
    try {
      replaceDurableCanonicalJsonCAS({
        canonicalPath,
        directory,
        stagePath,
        expectedCurrentSHA256: sha256(currentBytes),
        nextValue: next,
        verifyAuthority: () => {},
        validateCurrent: () => {},
        validateNext: () => {
          validations += 1;
          if (validations === 2) throw failure;
        },
        onDurableInstall: () => {
          visibleAtInstall = readFileSync(canonicalPath, "utf8");
          installed = true;
        },
      });
    } catch (error) {
      caught = error;
    }
    expect(installed).toBeTrue();
    expect(visibleAtInstall).toBe(`${canonicalJson(next)}\n`);
    expect(caught).toBe(failure);
    expect(validations).toBe(2);
    expect(existsSync(stagePath)).toBeFalse();
  });

  test("marker CAS reconciliation binds every old-stage-new failure cut", () => {
    const cases = [
      ["before_stage", "current"],
      ["staged", "current"],
      ["renamed", "next"],
      ["directory_close", "next"],
      ["durable_callback", "next"],
      ["post_validation", "next"],
    ] as const;
    for (const [cut, expectedState] of cases) {
      const directory = realpathSync(
        mkdtempSync(join(tmpdir(), `refence-marker-reconcile-${cut}-`)),
      );
      temporaryDirectories.push(directory);
      chmodSync(directory, 0o700);
      const canonicalPath = join(directory, "maintenance-active.json");
      const stagePath = join(directory, ".maintenance-next.tmp");
      const current = { checkpoint: "old", schema: "synthetic/v1" };
      const next = { checkpoint: "new", schema: "synthetic/v1" };
      const currentBytes = `${canonicalJson(current)}\n`;
      const nextBytes = `${canonicalJson(next)}\n`;
      writeFileSync(canonicalPath, currentBytes, { mode: 0o600 });
      chmodSync(canonicalPath, 0o600);
      let authorityChecks = 0;
      let nextValidations = 0;
      let durableObserved = 0;
      const failure = new Error(`cut_${cut}`);
      let caught: unknown = null;
      try {
        replaceDurableCanonicalJsonCAS({
          canonicalPath,
          directory,
          stagePath,
          expectedCurrentSHA256: sha256(currentBytes),
          nextValue: next,
          verifyAuthority: () => {
            authorityChecks += 1;
            if (
              (cut === "before_stage" && authorityChecks === 1) ||
              (cut === "staged" && authorityChecks === 2) ||
              (cut === "renamed" && authorityChecks === 3)
            ) throw failure;
          },
          validateCurrent: (value) => expect(value).toEqual(current),
          validateNext: (value) => {
            nextValidations += 1;
            expect(value).toEqual(next);
            if (cut === "post_validation" && nextValidations === 2) {
              throw failure;
            }
          },
          onDurableInstall: () => {
            durableObserved += 1;
            if (cut === "durable_callback") throw failure;
          },
          ...(cut === "directory_close"
            ? {
              fsyncDirectory: (path: string, afterSync?: () => void) => {
                const descriptor = openSync(path, fsConstants.O_RDONLY);
                fsyncSync(descriptor);
                afterSync?.();
                closeSync(descriptor);
                throw failure;
              },
            }
            : {}),
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBe(failure);
      const state = reconcileDurableCanonicalJsonTransitionForTest({
        canonicalPath,
        directory,
        stagePath,
        currentValue: current,
        currentSHA256: sha256(currentBytes),
        nextValue: next,
        nextSHA256: sha256(nextBytes),
        verifyAuthority: () => {},
        validate: (value) => {
          expect([canonicalJson(current), canonicalJson(next)]).toContain(
            canonicalJson(value),
          );
        },
      });
      expect(state).toBe(expectedState);
      expect(readFileSync(canonicalPath, "utf8")).toBe(
        expectedState === "current" ? currentBytes : nextBytes,
      );
      expect(existsSync(stagePath)).toBeFalse();
      expect(durableObserved).toBe(
        ["directory_close", "durable_callback", "post_validation"].includes(
            cut,
          )
          ? 1
          : 0,
      );
    }
    const source = readFileSync(
      join(import.meta.dir, "..", "phase-b-refence-maintenance-bridge.ts"),
      "utf8",
    );
    expect(source).toContain("if (durableInstallObserved) {");
    expect(source).toContain(
      "this.#verifyDurableTransition(next, nextSHA256);",
    );
    expect(source).toMatch(
      /} else if \(this\.#reconcileTransition\(next, nextSHA256\) === "next"\) \{\s*durableInstall\(\);/,
    );
    expect(source).toContain(
      'if (this.#value.status === "success_proven_receipt_pending")',
    );
  });

  test("special Fly argv is closed, including explicit primary start and stop", () => {
    const fly = "/Users/yournameisai/.cache/codex-tools/flyctl-v0.4.74/fly";
    expect(controllerFlyArgv({
      kind: "start",
      machineID: "e829421fd1e628",
    })).toEqual([
      fly,
      "machine",
      "start",
      "e829421fd1e628",
      "-a",
      "agenttool",
    ]);
    expect(controllerFlyArgv({
      kind: "wait_started",
      machineID: "e829421fd1e628",
    })).toEqual([
      fly,
      "machine",
      "wait",
      "e829421fd1e628",
      "-a",
      "agenttool",
      "--state",
      "started",
      "--wait-timeout",
      "5m0s",
    ]);
    expect(controllerFlyArgv({
      kind: "stop",
      machineID: "e820e09c6e7e28",
    })).toEqual([
      fly,
      "machine",
      "stop",
      "e820e09c6e7e28",
      "-a",
      "agenttool",
    ]);
    expect(controllerFlyArgv({
      kind: "refence_standby",
      machineID: "e820e09c6e7e28",
    })).toContain("--standby-for=");
    expect(() =>
      controllerFlyArgv({
        kind: "start",
        machineID: "bad",
      })
    ).toThrow(MaintenanceRefenceError);
  });

  test("Fly auth config parser accepts one closed shape without returning tokens", () => {
    const key = `${"A".repeat(43)}=`;
    const config = [
      `access_token: ${"B".repeat(128)}`,
      "app_secrets_minvers:",
      "    agenttool: 123",
      "last_login: 2026-08-25T12:00:00.000000Z",
      `metrics_token: FlyV1 ${"C".repeat(128)}`,
      "wire_guard_state:",
      "    personal:",
      "        org: personal",
      "        name: synthetic-wire-guard-name",
      "        region: lhr",
      `        localpublic: ${key}`,
      `        localprivate: ${key}`,
      '        dns: ""',
      "        peer:",
      "            peerip: fdaa:0:1::2",
      "            endpointip: synthetic.example.test",
      `            pubkey: ${key}`,
      "wire_guard_websockets: true",
      "",
    ].join("\n");
    expect(validateFlyAuthenticationConfigText(config)).toBeUndefined();
    expect(() =>
      validateFlyAuthenticationConfigText(
        config.replace(
          `access_token: ${"B".repeat(128)}`,
          "access_token: short",
        ),
      )
    ).toThrow(MaintenanceRefenceError);
    expect(() =>
      validateFlyAuthenticationConfigText(
        config.replace(
          "app_secrets_minvers:\n",
          "app_secrets_minvers:\nextra: value\n",
        ),
      )
    ).toThrow(MaintenanceRefenceError);
  });
});

function handoffFixture(): {
  paths: HandoffCeremonyPaths;
  markerBytes: string;
  classify: () => HandoffEdge;
} {
  const directory = mkdtempSync(join(tmpdir(), "agenttool-refence-handoff-"));
  temporaryDirectories.push(directory);
  chmodSync(directory, 0o700);
  const paths = {
    anchor: join(directory, "maintenance-active.json"),
    witness: join(directory, "mutation-active.json"),
    anchorArchive: join(directory, "anchor-retired.json"),
    witnessArchive: join(directory, "witness-retired.json"),
    stage: join(directory, ".maintenance-refence-stage.json"),
    directory,
  };
  const anchorBytes = "old-anchor\n";
  const witnessBytes = "armed-witness\n";
  const markerBytes = "new-maintenance-marker\n";
  writeFileSync(paths.anchor, anchorBytes, { mode: 0o600, flag: "wx" });
  writeFileSync(paths.witness, witnessBytes, { mode: 0o600, flag: "wx" });

  const exists = (path: string) => existsSync(path);
  const sameInode = (left: string, right: string) => {
    const first = lstatSync(left);
    const second = lstatSync(right);
    return first.dev === second.dev && first.ino === second.ino;
  };
  const classify = (): HandoffEdge => {
    const canonical = readFileSync(paths.anchor, "utf8");
    const witness = exists(paths.witness);
    const anchorArchive = exists(paths.anchorArchive);
    const witnessArchive = exists(paths.witnessArchive);
    const stage = exists(paths.stage);
    if (canonical === anchorBytes) {
      if (!witness) throw new Error("old blocker lost");
      if (!stage && !anchorArchive && !witnessArchive) return "H0";
      if (stage && !anchorArchive && !witnessArchive) {
        if (readFileSync(paths.stage, "utf8") !== markerBytes) {
          throw new Error("bad stage");
        }
        return "H1";
      }
      if (stage && anchorArchive && !witnessArchive) {
        if (!sameInode(paths.anchor, paths.anchorArchive)) {
          throw new Error("bad anchor link");
        }
        return "H2";
      }
      if (stage && anchorArchive && witnessArchive) {
        if (
          !sameInode(paths.anchor, paths.anchorArchive) ||
          !sameInode(paths.witness, paths.witnessArchive)
        ) throw new Error("bad evidence links");
        return "H3";
      }
      throw new Error("unknown old-marker half-edge");
    }
    if (
      canonical !== markerBytes || stage || !anchorArchive || !witnessArchive
    ) {
      throw new Error("unknown new-marker half-edge");
    }
    if (
      readFileSync(paths.anchorArchive, "utf8") !== anchorBytes ||
      readFileSync(paths.witnessArchive, "utf8") !== witnessBytes
    ) {
      throw new Error("archive bytes changed");
    }
    return witness ? "H4" : "H5";
  };
  return { paths, markerBytes, classify };
}

describe("one-shot database origin convergence (58-case matrix)", () => {
  test("A1 pins the exact serializable SQL bundle", () => {
    expect(databaseOriginStatementSHA256ForTest()).toBe(
      "00e53468e58ad0c0d7db6255278fd122b19683fa370aab457500218d0a7675f2",
    );
  });

  test("A2 accepts only the exact old-to-target proof delta", () => {
    const before = structuredClone(guardFixture().database) as DatabaseProof;
    const { proof, after } = databaseConvergenceProofFixture(before);
    expect(validateDatabaseOriginConvergenceForTest(proof, before, after))
      .toEqual({
        beforeProofSHA256: sha256(canonicalJson(before)),
        afterProofSHA256: sha256(canonicalJson(after)),
      });
    expectMaintenanceRefusalCode(() =>
      validateDatabaseOriginConvergenceForTest(
        { ...proof, clock_before: "2026-02-30T00:00:00.000000Z" },
        before,
        after,
      ), "database_convergence_proof");
  });

  test("A3 persists intent, commit, proof, and complete marker binding", async () => {
    const fixture = databaseConvergenceCoreFixture();
    const result = await fixture.run();
    expect(fixture.events).toEqual([
      "intent",
      "intent_readback",
      "preproof",
      "cas",
      "commit",
      "postproof",
      "verified",
    ]);
    expect(fixture.counts()).toEqual({ cas: 1, manual: 0 });
    expect(fixture.wal.projection().terminal_phase).toBe("verified");
    const states = databaseConvergenceMarkerStates(result, fixture.wal);
    expect(
      validateVerifiedDatabaseConvergenceForTest(
        states.verified,
        result,
        fixture.wal,
      ),
    ).toMatch(/^[0-9a-f]{64}$/);
  });

  const invalidInherited = (
    mutate: (proof: DatabaseProof) => void,
  ): DatabaseProof => {
    const proof = structuredClone(guardFixture().database) as DatabaseProof;
    mutate(proof);
    return proof;
  };
  const admissionCases: Array<[
    string,
    () => ReturnType<typeof databaseConvergenceCoreFixture>,
  ]> = [
    [
      "B1 refuses H4",
      () => databaseConvergenceCoreFixture({ handoffEdge: "H4" }),
    ],
    [
      "B2 refuses a preexisting interrupt",
      () => databaseConvergenceCoreFixture({ interruptedInitially: true }),
    ],
    [
      "B3 refuses a non-controller-ready WAL",
      () => databaseConvergenceCoreFixture({ readyCheckpoint: "other_ready" }),
    ],
    [
      "B4 refuses a target URL before intent",
      () =>
        databaseConvergenceCoreFixture({
          inheritedProof: invalidInherited((value) => {
            value.federation_instance_url_sha256 = TARGET_URL_SHA256;
          }),
        }),
    ],
    ["B5 refuses an unknown URL", () =>
      databaseConvergenceCoreFixture({
        inheritedProof: invalidInherited((value) => {
          value.federation_instance_url_sha256 = digest("f");
        }),
      })],
    ["B6 refuses old timestamp drift", () =>
      databaseConvergenceCoreFixture({
        inheritedProof: invalidInherited((value) => {
          value.federation_updated_at = CONVERGED_UPDATED_AT;
        }),
      })],
    ["B7 refuses enabled federation", () =>
      databaseConvergenceCoreFixture({
        inheritedProof: invalidInherited((value) => {
          value.federation_disabled = false;
        }),
      })],
    ["B8 refuses nonempty origins", () =>
      databaseConvergenceCoreFixture({
        inheritedProof: invalidInherited((value) => {
          value.allowed_origins_count = 1;
        }),
      })],
    ["B9 refuses a durable hold", () =>
      databaseConvergenceCoreFixture({
        inheritedProof: invalidInherited((value) => {
          value.durable_hold = true;
        }),
      })],
    [
      "B10 refuses reserved generation rows",
      () =>
        databaseConvergenceCoreFixture({
          inheritedProof: invalidInherited((value) => {
            value.reserved_generation_rows = 1;
          }),
        }),
    ],
    ["B11 refuses authoritative v2 rows", () =>
      databaseConvergenceCoreFixture({
        inheritedProof: invalidInherited((value) => {
          value.authoritative_v2_rows = 1;
        }),
      })],
    ["B12 refuses received v1 rows", () =>
      databaseConvergenceCoreFixture({
        inheritedProof: invalidInherited((value) => {
          value.received_v1_rows = 1;
        }),
      })],
  ];
  for (const [name, build] of admissionCases) {
    test(name, async () => {
      const fixture = build();
      await expect(fixture.run()).rejects.toBeInstanceOf(
        MaintenanceRefenceError,
      );
      expect(fixture.counts()).toEqual({ cas: 0, manual: 0 });
      expect(fixture.wal.projection().terminal_phase).toBe("ready");
    });
  }

  for (
    const [name, options] of [
      ["C1 WAL intent without marker", { failAt: "intent" }],
      ["C2 interrupt after marker intent", { interruptAfter: "intent" }],
      ["C3 marker intent readback failure", { failAt: "intent_readback" }],
      ["C4 old preproof failure", { failAt: "preproof" }],
    ] as const
  ) {
    test(name, async () => {
      const fixture = databaseConvergenceCoreFixture(options);
      await expect(fixture.run()).rejects.toBeInstanceOf(
        ControllerManualInterventionError,
      );
      expect(fixture.counts()).toEqual({ cas: 0, manual: 1 });
      expect(fixture.wal.projection().terminal_phase).toBe(
        "failed_or_uncertain",
      );
    });
  }
});

describe("database convergence proof and ambiguity matrix", () => {
  const proofMutations: Array<[
    string,
    (proof: DatabaseOriginConvergenceProof) => void,
  ]> = [
    ["D1 statement hash", (value) => value.statement_sha256 = digest("f")],
    [
      "D2 database target",
      (value) => value.database_target_sha256 = digest("f"),
    ],
    ["D3 before row hash", (value) => value.before_row_sha256 = "bad"],
    ["D4 after row hash", (value) => value.after_row_sha256 = "bad"],
    [
      "D5 unchanged projection",
      (value) => value.unchanged_projection_sha256 = "bad",
    ],
    ["D6 delta hash", (value) => value.delta_sha256 = digest("f")],
    [
      "D7 before URL",
      (value) => value.before_instance_url_sha256 = TARGET_URL_SHA256 as any,
    ],
    [
      "D8 after URL",
      (value) =>
        value.after_instance_url_sha256 = PRE_REFENCE_URL_SHA256 as any,
    ],
    [
      "D9 old timestamp",
      (value) => value.before_updated_at = CONVERGED_UPDATED_AT as any,
    ],
    [
      "D10 non-advancing timestamp",
      (value) => value.after_updated_at = PRE_REFENCE_UPDATED_AT,
    ],
    [
      "D11 database clock order",
      (value) => value.clock_before = CONVERGENCE_CLOCK_AFTER,
    ],
    ["D12 write truth", (value) => value.commit_ambiguity = true as false],
  ];
  for (const [name, mutate] of proofMutations) {
    test(name, async () => {
      const before = structuredClone(guardFixture().database) as DatabaseProof;
      const proof = databaseConvergenceProofFixture(before).proof;
      mutate(proof);
      const fixture = databaseConvergenceCoreFixture({ proof });
      await expect(fixture.run()).rejects.toBeInstanceOf(
        ControllerManualInterventionError,
      );
      expect(fixture.counts()).toEqual({ cas: 1, manual: 1 });
      expect(fixture.events).not.toContain("verified");
    });
  }

  const ambiguityCases: Array<[
    string,
    Parameters<typeof databaseConvergenceCoreFixture>[0],
  ]> = [
    ["E1 transaction rejection", { failAt: "cas" }],
    ["E2 acknowledged close failure", {
      acknowledgedFailureCode: "database_convergence_close",
    }],
    ["E3 acknowledged deadline", {
      acknowledgedFailureCode: "database_convergence_deadline",
    }],
    ["E4 acknowledged signal", {
      acknowledgedFailureCode: "database_convergence_interrupted",
    }],
    ["E5 live signal before SQL", { interruptAfter: "preproof" }],
    ["E6 live signal after commit", { interruptAfter: "cas" }],
    ["E7 live signal after commit marker", { interruptAfter: "commit" }],
    ["E8 live signal after postproof", { interruptAfter: "postproof" }],
    ["E9 live signal after verified marker", { interruptAfter: "verified" }],
  ];
  for (const [name, options] of ambiguityCases) {
    test(name, async () => {
      const fixture = databaseConvergenceCoreFixture(options);
      await expect(fixture.run()).rejects.toBeInstanceOf(
        ControllerManualInterventionError,
      );
      expect(fixture.counts().manual).toBe(1);
      expect(fixture.wal.projection().terminal_phase).toBe(
        "failed_or_uncertain",
      );
    });
  }

  const postproofMutations: Array<[string, (proof: DatabaseProof) => void]> = [
    [
      "F1 endpoint URL split",
      (value) => value.federation_instance_url_sha256 = PRE_REFENCE_URL_SHA256,
    ],
    [
      "F2 endpoint timestamp split",
      (value) => value.federation_updated_at = "2026-08-25T12:00:03.000000Z",
    ],
    [
      "F3 journal drift",
      (value) => value.journal_inventory_sha256 = digest("f"),
    ],
    [
      "F4 definition drift",
      (value) => value.migration_definitions_verified = false,
    ],
    ["F5 data drift", (value) => value.migration_data_verified = false],
    ["F6 authority drift", (value) => value.authoritative_v2_rows = 1],
    ["F7 drain drift", (value) => value.drain_zero = false],
    [
      "F8 informational drift",
      (value) => value.drain_informational.payout_requested += 1,
    ],
    [
      "F9 database target drift",
      (value) => value.database_target_sha256 = digest("f"),
    ],
  ];
  for (const [name, mutate] of postproofMutations) {
    test(name, async () => {
      const before = structuredClone(guardFixture().database) as DatabaseProof;
      const generated = databaseConvergenceProofFixture(before);
      mutate(generated.after);
      const fixture = databaseConvergenceCoreFixture({
        proof: generated.proof,
        postProof: generated.after,
      });
      await expect(fixture.run()).rejects.toBeInstanceOf(
        ControllerManualInterventionError,
      );
      expect(fixture.events).not.toContain("verified");
      expect(fixture.counts()).toEqual({ cas: 1, manual: 1 });
    });
  }
});

describe("database convergence reentry and marker schema matrix", () => {
  test("G1 a completed run cannot be invoked twice", async () => {
    const fixture = databaseConvergenceCoreFixture();
    await fixture.run();
    await expect(fixture.run()).rejects.toBeInstanceOf(
      MaintenanceRefenceError,
    );
    expect(fixture.counts()).toEqual({ cas: 1, manual: 0 });
  });
  for (const phase of ["intent", "commit", "verified"] as const) {
    test(`G${phase === "intent" ? 2 : phase === "commit" ? 3 : 4} refuses retained ${phase} WAL`, async () => {
      const fixture = databaseConvergenceCoreFixture();
      const intent = appendDatabaseConvergenceIntentForTest({
        wal: fixture.wal,
        recordedAt: "2026-08-25T12:00:00Z",
        beforeProofSHA256: sha256(canonicalJson(fixture.inheritedProof)),
        databaseTargetSHA256: fixture.inheritedProof.database_target_sha256,
      });
      let commit = null;
      if (phase !== "intent") {
        commit = appendDatabaseConvergenceCommitForTest({
          wal: fixture.wal,
          recordedAt: "2026-08-25T12:00:01Z",
          proof: fixture.proof,
        });
      }
      if (phase === "verified") {
        appendDatabaseConvergenceVerifiedForTest({
          wal: fixture.wal,
          recordedAt: "2026-08-25T12:00:02Z",
          proof: fixture.proof,
          afterProofSHA256: sha256(canonicalJson(fixture.postProof)),
        });
      }
      expect(intent.phase).toBe("attempting");
      if (commit) expect(commit.phase).toBe("settled");
      await expect(fixture.run()).rejects.toBeInstanceOf(
        MaintenanceRefenceError,
      );
      expect(fixture.counts()).toEqual({ cas: 0, manual: 0 });
    });
  }

  test("H1 accepts only the exact monotonic four-state sequence", async () => {
    const fixture = databaseConvergenceCoreFixture();
    const result = await fixture.run();
    const states = databaseConvergenceMarkerStates(result, fixture.wal);
    for (const state of Object.values(states)) {
      expect(() => validateDatabaseConvergenceMarkerForTest(state)).not
        .toThrow();
    }
    validateDatabaseConvergenceTransitionForTest(states.initial, states.intent);
    validateDatabaseConvergenceTransitionForTest(states.intent, states.commit);
    validateDatabaseConvergenceTransitionForTest(
      states.commit,
      states.verified,
    );
    expectMaintenanceRefusalCode(
      () =>
        validateDatabaseConvergenceMarkerForTest({
          ...states.initial,
          before_updated_at: "2026-02-30T00:00:00.000000Z",
        }),
      "bridge_marker_database_convergence",
    );
  });
  test("H2 rejects a skipped commit state", async () => {
    const fixture = databaseConvergenceCoreFixture();
    const states = databaseConvergenceMarkerStates(
      await fixture.run(),
      fixture.wal,
    );
    expect(() =>
      validateDatabaseConvergenceTransitionForTest(
        states.initial,
        states.commit,
      )
    ).toThrow(MaintenanceRefenceError);
  });
  test("H3 rejects a backward verified state", async () => {
    const fixture = databaseConvergenceCoreFixture();
    const states = databaseConvergenceMarkerStates(
      await fixture.run(),
      fixture.wal,
    );
    expect(() =>
      validateDatabaseConvergenceTransitionForTest(
        states.verified,
        states.commit,
      )
    ).toThrow(MaintenanceRefenceError);
  });
  test("H4 rejects an impossible independent marker boolean", async () => {
    const fixture = databaseConvergenceCoreFixture();
    const states = databaseConvergenceMarkerStates(
      await fixture.run(),
      fixture.wal,
    );
    const impossible = { ...states.intent, statement_attempted: false };
    expect(() => validateDatabaseConvergenceMarkerForTest(impossible)).toThrow(
      MaintenanceRefenceError,
    );
  });
  test("H5 binds every verified marker field to exact WAL bytes", async () => {
    const fixture = databaseConvergenceCoreFixture();
    const result = await fixture.run();
    const states = databaseConvergenceMarkerStates(result, fixture.wal);
    const tampered = { ...states.verified, intent_wal_sha256: digest("f") };
    expect(() =>
      validateVerifiedDatabaseConvergenceForTest(
        tampered,
        result,
        fixture.wal,
      )
    ).toThrow(MaintenanceRefenceError);
  });
});

describe("stage-first handoff crash law", () => {
  for (const crashAfter of ["H0", "H1", "H2", "H3", "H4", "H5"] as const) {
    test(`recovers the exact ${crashAfter} durable edge with no blocker absence`, () => {
      const fixture = handoffFixture();
      expect(() =>
        performHandoffCeremony({
          initialEdge: "H0",
          paths: fixture.paths,
          markerBytes: fixture.markerBytes,
          refresh: fixture.classify,
          crashAfter,
        })
      ).toThrow(MaintenanceRefenceError);
      expect(fixture.classify()).toBe(crashAfter);
      const completion = performHandoffCeremony({
        initialEdge: crashAfter,
        paths: fixture.paths,
        markerBytes: fixture.markerBytes,
        refresh: fixture.classify,
      });
      expect(completion.edge).toBe("H5");
      expect(completion.resumed_from).toBe(crashAfter);
      expect(fixture.classify()).toBe("H5");
      expect(lstatSync(fixture.paths.anchorArchive).nlink).toBe(1);
      expect(lstatSync(fixture.paths.witnessArchive).nlink).toBe(1);
    });
  }

  const surgicalCrashes: ReadonlyArray<[HandoffCrashPoint, HandoffEdge]> = [
    ["H1_file_fsynced_before_directory_fsync", "H1"],
    ["H2_linked_before_directory_fsync", "H2"],
    ["H3_linked_before_directory_fsync", "H3"],
    ["H4_renamed_before_directory_fsync", "H4"],
    ["H5_unlinked_before_directory_fsync", "H5"],
  ];
  for (const [crashAt, visibleEdge] of surgicalCrashes) {
    test(`repairs ${crashAt} only as the exact visible ${visibleEdge} edge`, () => {
      const fixture = handoffFixture();
      expect(() =>
        performHandoffCeremony({
          initialEdge: "H0",
          paths: fixture.paths,
          markerBytes: fixture.markerBytes,
          refresh: fixture.classify,
          crashAt,
        })
      ).toThrow(MaintenanceRefenceError);
      expect(fixture.classify()).toBe(visibleEdge);
      expect(
        performHandoffCeremony({
          initialEdge: visibleEdge,
          paths: fixture.paths,
          markerBytes: fixture.markerBytes,
          refresh: fixture.classify,
        }).edge,
      ).toBe("H5");
      expect(fixture.classify()).toBe("H5");
    });
  }

  test("refuses an unenumerated archive-before-stage half-edge", () => {
    const fixture = handoffFixture();
    linkSync(fixture.paths.witness, fixture.paths.witnessArchive);
    expect(() => fixture.classify()).toThrow("unknown old-marker half-edge");
  });

  test("descriptor chmod cannot affect a swapped H1 stage pathname", () => {
    const fixture = handoffFixture();
    const replacementBytes = "same-uid-swapped-stage\n";
    expect(() =>
      performHandoffCeremony({
        initialEdge: "H0",
        paths: fixture.paths,
        markerBytes: fixture.markerBytes,
        refresh: fixture.classify,
        afterStageOpenForTest: () => {
          unlinkSync(fixture.paths.stage);
          writeFileSync(fixture.paths.stage, replacementBytes, {
            flag: "wx",
            mode: 0o644,
          });
          chmodSync(fixture.paths.stage, 0o644);
        },
      })
    ).toThrow("handoff_stage_identity");
    expect(readFileSync(fixture.paths.stage, "utf8")).toBe(replacementBytes);
    expect(lstatSync(fixture.paths.stage).mode & 0o777).toBe(0o644);
    expect(readFileSync(fixture.paths.anchor, "utf8")).toBe("old-anchor\n");
    expect(readFileSync(fixture.paths.witness, "utf8")).toBe("armed-witness\n");
    expect(existsSync(fixture.paths.anchorArchive)).toBeFalse();
    expect(existsSync(fixture.paths.witnessArchive)).toBeFalse();
  });
});

const roles: RoleMap = {
  app_lhr: ["8606e9ae201e98", "e82945ec50ee08"],
  app_cdg: "8d9e16ce7573d8",
  thinker_primary: "e829421fd1e628",
  thinker_standby: "e820e09c6e7e28",
};

const RESTORED_CONFIG_SHA256_BY_ROLE = Object.freeze({
  app_lhr_1: "d7c0bc01f57722982255c9878b20cc7e4d9273bbaa0c7c8a42ecdfbf5fc5f538",
  app_lhr_2: "d7c0bc01f57722982255c9878b20cc7e4d9273bbaa0c7c8a42ecdfbf5fc5f538",
  app_cdg: "d7c0bc01f57722982255c9878b20cc7e4d9273bbaa0c7c8a42ecdfbf5fc5f538",
  thinker_primary:
    "c780301f005cc3739f73201ddc0b3678129e00b0261f314a8569273951082e99",
  thinker_standby:
    "cd85d59bb91a78dad8067228cc2d4d791be08e4c44de87dcb81bba11f3f6b6cf",
});

function restoredConfigSHA256ByMachine(
  roleMap: RoleMap,
): Record<string, string> {
  return {
    [roleMap.app_lhr[0]]: RESTORED_CONFIG_SHA256_BY_ROLE.app_lhr_1,
    [roleMap.app_lhr[1]]: RESTORED_CONFIG_SHA256_BY_ROLE.app_lhr_2,
    [roleMap.app_cdg]: RESTORED_CONFIG_SHA256_BY_ROLE.app_cdg,
    [roleMap.thinker_primary]: RESTORED_CONFIG_SHA256_BY_ROLE.thinker_primary,
    [roleMap.thinker_standby]: RESTORED_CONFIG_SHA256_BY_ROLE.thinker_standby,
  };
}

const PRODUCER_ZERO_DRAIN_FIELDS_FOR_TEST = [
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
] as const;

function stoppedFleet(): { fleet: any[]; hashes: Record<string, string> } {
  const applications = new Set([...roles.app_lhr, roles.app_cdg]);
  const fleet = [
    ...roles.app_lhr.map((id) => [id, "lhr"]),
    [roles.app_cdg, "cdg"],
    [roles.thinker_primary, "lhr"],
    [roles.thinker_standby, "lhr"],
  ].map(([id, region]) => {
    const app = applications.has(id!);
    const imageRef = {
      registry: "registry.fly.io",
      repository: "agenttool",
      tag: "maintenance-526edc4ee0d0-20260824T210704Z-6e9e59cc185245bc",
      digest:
        "sha256:ecb322baec96707f59603121cfd4613d08ff7b1da8bf338fa118453b45d3e72c",
      labels: {
        "org.opencontainers.image.revision":
          "526edc4ee0d076783d157591d7e3434352f6fc84",
        "dev.agenttool.source.dirty": "false",
      },
    };
    return {
      id,
      state: "stopped",
      region,
      host_status: "ok",
      instance_id: `instance-${id}`,
      updated_at: "2026-08-25T12:00:00Z",
      cordoned: app,
      image_ref: imageRef,
      config: {
        image:
          "registry.fly.io/agenttool:maintenance-526edc4ee0d0-20260824T210704Z-6e9e59cc185245bc@sha256:ecb322baec96707f59603121cfd4613d08ff7b1da8bf338fa118453b45d3e72c",
        env: {
          AGENTTOOL_DISABLE_WORKERS: "1",
          ...(app ? {} : { AGENTOOL_ENABLE_THINKER: "1" }),
        },
        init: {
          cmd: app
            ? ["bun", "run", "src/index.ts"]
            : ["bun", "run", "src/thinker.ts"],
        },
        metadata: { fly_process_group: app ? "app" : "thinker" },
        guest: { cpu_kind: "shared", cpus: 1, memory_mb: app ? 1024 : 256 },
        restart: { policy: "no", max_retries: 10 },
        standbys: [],
        ...(app
          ? {
            services: [{
              protocol: "tcp",
              internal_port: 3000,
              autostart: false,
              autostop: "off",
              min_machines_running: 1,
              ports: [
                { port: 80, handlers: ["http"] },
                { port: 443, handlers: ["tls", "http"] },
              ],
            }],
          }
          : {}),
      },
    };
  });
  const hashes: Record<string, string> = {};
  for (const machine of fleet) {
    const config = structuredClone(machine.config);
    delete config.image;
    delete config.standbys;
    hashes[machine.id!] = sha256(canonicalJson(config));
  }
  return { fleet, hashes };
}

function fullFleetSHA256(fleet: readonly any[]): string {
  return sha256(canonicalJson(
    structuredClone(fleet).sort((left: any, right: any) =>
      String(left.id).localeCompare(String(right.id))
    ),
  ));
}

function guardFixture(
  options: {
    driftFleet?: boolean;
    driftLocal?: boolean;
    targetDatabase?: boolean;
  } = {},
) {
  const targetRevision = AUTHORIZED_H0_TARGET_REVISION;
  const targetTree = AUTHORIZED_H0_TARGET_TREE;
  const receiptSHA256 = AUTHORIZED_H0_RECEIPT_SHA256;
  const fleet = stoppedFleet();
  const evidence: TerminalEvidence = {
    receipt: {
      audit_evidence: { witness_sha256: digest("a") },
      prior_audited_lineage: {
        protected_main_revision: revision("c"),
        protected_main_tree: revision("d"),
        clean_526_ancestor_distance: 12,
        evidence_only: true,
        readmission_authority: false,
      },
      terminal_fleet_sha256: fullFleetSHA256(fleet.fleet),
    },
    receiptSHA256,
    runID: AUTHORIZED_H0_RUN_ID,
    roles,
    sourceRevision: "526edc4ee0d076783d157591d7e3434352f6fc84",
    sourceTree: "ff77236e51cad8acc99ee4064af48b689df85854",
    targetRevision,
    targetTree,
    targetDistance: 47,
    anchor: {},
    anchorSHA256: digest("d"),
    anchorPath: "/synthetic/anchor",
    anchorArchivePath: "/synthetic/anchor-retired",
    anchorStat: {} as any,
    witness: {},
    witnessSHA256: digest("e"),
    witnessPath: "/synthetic/witness",
    witnessArchivePath: "/synthetic/witness-retired",
    witnessStat: {} as any,
    walDirectory: "/synthetic/wal",
    walInventorySHA256: digest("f"),
    terminalWalSHA256: digest("1"),
    imageContract: {
      configImage:
        "registry.fly.io/agenttool:maintenance-526edc4ee0d0-20260824T210704Z-6e9e59cc185245bc@sha256:ecb322baec96707f59603121cfd4613d08ff7b1da8bf338fa118453b45d3e72c",
      digest:
        "sha256:ecb322baec96707f59603121cfd4613d08ff7b1da8bf338fa118453b45d3e72c",
      fullImageRefSha256: sha256(canonicalJson(fleet.fleet[0]!.image_ref)),
      revision: "526edc4ee0d076783d157591d7e3434352f6fc84",
      tag: "maintenance-526edc4ee0d0-20260824T210704Z-6e9e59cc185245bc",
    },
    sourceInventorySHA256: digest("9"),
    journalInventorySHA256: digest("5"),
    cronSHA256:
      "22c6d715e02a1127fe73e743d41694bbe85aaa2bb3674a77703cdb469546fc34",
    restoredConfigSHA256ByMachine: restoredConfigSHA256ByMachine(roles),
    fencedConfigSHA256ByMachine: fleet.hashes,
    deployReceiptInventorySHA256: digest("2"),
    deployReceiptFileCount: 17,
    producerAdmission: {
      embeddedCriticalContractSHA256: digest("6"),
      localStateSandwichSHA256: digest("7"),
    },
    producerTerminalProof: {
      journalSHA256: digest("8"),
      drainSampleSHA256: digest("9"),
      drainEventSHA256s: [digest("a"), digest("b"), digest("c")],
    },
    producerGuardRawSHA256: AUTHORIZED_H0_GUARD_RAW_SHA256,
    producerGuardNormalizedSHA256: AUTHORIZED_H0_GUARD_NORMALIZED_SHA256,
    bridgeRawSHA256: digest("3"),
    bridgeNormalizedSHA256: digest("4"),
    edge: "H5",
  };
  const counts: Record<string, number> = {};
  const count = <T>(name: string, value: T | (() => T)): T => {
    counts[name] = (counts[name] ?? 0) + 1;
    return typeof value === "function" ? (value as () => T)() : value;
  };
  let fleetReads = 0;
  let localReads = 0;
  const targetAppliedAt = [
    "2026-08-24T21:02:16.132506Z",
    "2026-08-24T21:02:16.520915Z",
  ] as [string, string];
  const sourceMigrations = [
    ...Array.from({ length: 175 }, (_, index) => ({
      filename: String(index + 1).padStart(4, "0") + "_synthetic.sql",
      checksum: sha256(String(index + 1)),
    })),
    {
      filename: "20260824T120000_covenant_v2_generation_hold.sql",
      checksum:
        "2f3463f4f45a62f283c5b5d4b47410b9cb6d8c6ac3dd5210d09e837e1e6b5f1f",
    },
    {
      filename: "20260824T132712_crypto_deposit_remainder_accounting.sql",
      checksum:
        "2fda8bb8440f8d58a78c051eca36e3097dbf3e4ad8844d028a66cfaee39a17eb",
    },
  ];
  const journalRows = sourceMigrations.map((entry, index) => ({
    ...entry,
    applied_at: index === 175
      ? targetAppliedAt[0]
      : index === 176
      ? targetAppliedAt[1]
      : "2026-08-24T20:" +
        String(Math.floor(index / 60)).padStart(2, "0") + ":" +
        String(index % 60).padStart(2, "0") + ".000000Z",
  }));
  const terminalJournal = {
    transaction: { rows: journalRows, targetAppliedAt },
    session: { rows: journalRows, targetAppliedAt },
  };
  const drainSnapshot = {
    counts: Object.fromEntries(
      PRODUCER_ZERO_DRAIN_FIELDS_FOR_TEST.map((field) => [field, 0]),
    ),
    informational: { payout_requested: 17, x402_inserted: 23 },
    cron_sha256:
      "22c6d715e02a1127fe73e743d41694bbe85aaa2bb3674a77703cdb469546fc34",
  };
  const terminalDrainSnapshots = Array.from(
    { length: 3 },
    () => structuredClone(drainSnapshot),
  );
  const database = {
    source_inventory_sha256: sha256(canonicalJson(sourceMigrations)),
    journal_file_count: 177,
    journal_endpoint_count: 2,
    journal_observation_count: 4,
    journal_inventory_sha256: sha256(canonicalJson(journalRows)),
    target_migration_applied_at: targetAppliedAt,
    migration_definitions_verified: true,
    migration_data_verified: true,
    remainder_affected_count: 0,
    federation_disabled: true,
    federation_instance_url_sha256: options.targetDatabase
      ? "beb8e35af063f5f2619474d6af1757bca1b0cddc801842d39cdf0bb1ada8f37d"
      : "46b695dffb312f6591e480ec5882d894e1b5e1efdb3bfc05da6303f9259ba818",
    federation_updated_at: options.targetDatabase
      ? "2026-08-25T12:00:00.000000Z"
      : "2026-08-21T18:49:13.745704Z",
    durable_hold: false,
    allowed_origins_count: 0,
    reserved_generation_rows: 0,
    authoritative_v2_rows: 0,
    received_v1_rows: 0,
    drain_sample_count: 3,
    drain_informational: { payout_requested: 17, x402_inserted: 23 },
    drain_zero: true,
    cron_sha256:
      "22c6d715e02a1127fe73e743d41694bbe85aaa2bb3674a77703cdb469546fc34",
    database_target_sha256: digest("6"),
    producer_authority: {
      source_migrations: sourceMigrations,
      terminal_journal: terminalJournal,
      terminal_drain_snapshots: terminalDrainSnapshots,
    },
  };
  evidence.sourceInventorySHA256 = database.source_inventory_sha256;
  evidence.journalInventorySHA256 = database.journal_inventory_sha256;
  evidence.producerAdmission.embeddedCriticalContractSHA256 =
    producerCriticalContractSHA256ForTest(sourceMigrations, evidence);
  evidence.producerTerminalProof.journalSHA256 = sha256(
    canonicalJson(terminalJournal),
  );
  evidence.producerTerminalProof.drainSampleSHA256 = sha256(
    canonicalJson(terminalDrainSnapshots),
  );
  evidence.producerTerminalProof.drainEventSHA256s = terminalDrainSnapshots.map(
    (snapshot) => sha256(canonicalJson(snapshot)),
  ) as [string, string, string];
  const dependencies: MaintenanceRefenceDependencies = {
    readDatabaseProof: async () => count("database", structuredClone(database)),
    readProviderSecretInventory: async () => count("provider", []),
    readKeychainProof: async () =>
      count("keychain", {
        generation_absent: true,
        machine_map_sha256:
          "8c27bb32b5306ebdc4fa4b630d58cd098203c0dd762ee2f0f42e73c9aef5c8d1",
        roles,
      }),
    readProcessProof: async () =>
      count("process", {
        conflicting_process_count: 0,
        projection_sha256: digest("7"),
      }),
    readGitProof: async () =>
      count("git", protectedSuccessorGitProof(evidence)),
    readFleetInventory: async () => {
      count("fleet", true);
      fleetReads += 1;
      const value = structuredClone(fleet.fleet);
      if (options.driftFleet && fleetReads === 2) {
        value[0].updated_at = "2026-08-25T12:00:01Z";
      }
      return value;
    },
    pause: async (milliseconds) => {
      expect(milliseconds).toBe(1_137);
      count("pause", true);
    },
    close: async () => {
      count("close", true);
    },
  };
  const readEvidence = () => {
    localReads += 1;
    const value = structuredClone(evidence);
    if (options.driftLocal && localReads === 2) {
      value.terminalWalSHA256 = digest("8");
    }
    return value;
  };
  return {
    counts,
    database,
    dependencies,
    evidence,
    readEvidence,
    request: {
      checkpoint: "early" as const,
      receiptSHA256,
      targetRevision,
      targetTree,
      rolloutID:
        "maintenance-refence-d87a3f35c80b-20260825T120000Z-0123456789abcdef",
    },
  };
}

const PRE_REFENCE_URL_SHA256 =
  "46b695dffb312f6591e480ec5882d894e1b5e1efdb3bfc05da6303f9259ba818";
const TARGET_URL_SHA256 =
  "beb8e35af063f5f2619474d6af1757bca1b0cddc801842d39cdf0bb1ada8f37d";
const PRE_REFENCE_UPDATED_AT = "2026-08-21T18:49:13.745704Z";
const CONVERGED_UPDATED_AT = "2026-08-25T12:00:01.000000Z";
const CONVERGENCE_CLOCK_BEFORE = "2026-08-25T12:00:00.000000Z";
const CONVERGENCE_CLOCK_AFTER = "2026-08-25T12:00:02.000000Z";

function databaseConvergenceProofFixture(
  before: DatabaseProof,
  afterUpdatedAt = CONVERGED_UPDATED_AT,
): { proof: DatabaseOriginConvergenceProof; after: DatabaseProof } {
  const after = structuredClone(before);
  after.federation_instance_url_sha256 = TARGET_URL_SHA256;
  after.federation_updated_at = afterUpdatedAt;
  const proof: DatabaseOriginConvergenceProof = {
    schema: "agenttool-phase-b-refence-database-origin-convergence/v1",
    statement_sha256: databaseOriginStatementSHA256ForTest(),
    database_target_sha256: before.database_target_sha256,
    before_row_sha256: digest("1"),
    after_row_sha256: digest("2"),
    unchanged_projection_sha256: digest("3"),
    delta_sha256: sha256(canonicalJson({
      after_instance_url_sha256: TARGET_URL_SHA256,
      after_updated_at: afterUpdatedAt,
      before_instance_url_sha256: PRE_REFENCE_URL_SHA256,
      before_updated_at: PRE_REFENCE_UPDATED_AT,
      clock_after: CONVERGENCE_CLOCK_AFTER,
      clock_before: CONVERGENCE_CLOCK_BEFORE,
    })),
    before_instance_url_sha256: PRE_REFENCE_URL_SHA256,
    after_instance_url_sha256: TARGET_URL_SHA256,
    before_updated_at: PRE_REFENCE_UPDATED_AT,
    after_updated_at: afterUpdatedAt,
    clock_before: CONVERGENCE_CLOCK_BEFORE,
    clock_after: CONVERGENCE_CLOCK_AFTER,
    database_write_attempt_count: 1,
    rows_updated: 1,
    commit_acknowledged: true,
    commit_ambiguity: false,
    rollback_attempt_count: 0,
  };
  return { proof, after };
}

function databaseConvergenceCoreFixture(
  options: {
    handoffEdge?: HandoffEdge;
    readyCheckpoint?: string;
    inheritedProof?: DatabaseProof;
    preProof?: DatabaseProof;
    postProof?: DatabaseProof;
    proof?: DatabaseOriginConvergenceProof;
    failAt?: string;
    interruptAfter?: string;
    interruptedInitially?: boolean;
    acknowledgedFailureCode?: string;
  } = {},
) {
  const guard = guardFixture();
  const inheritedProof = structuredClone(
    options.inheritedProof ?? guard.database,
  ) as DatabaseProof;
  const generated = databaseConvergenceProofFixture(inheritedProof);
  const proof = structuredClone(options.proof ?? generated.proof);
  const postProof = structuredClone(options.postProof ?? generated.after);
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), "refence-database-convergence-")),
  );
  temporaryDirectories.push(directory);
  chmodSync(directory, 0o700);
  const wal = new ControllerWalWriter({
    directory,
    controllerRunID: "01234567-89ab-cdef-0123-456789abcdef",
    rolloutID:
      "maintenance-refence-aaaaaaaaaaaa-20260825T120000Z-0123456789abcdef",
    receiptSHA256: digest("a"),
  });
  wal.append({
    recorded_at: "2026-08-25T11:59:59Z",
    phase: "ready",
    checkpoint: options.readyCheckpoint ?? "controller_ready",
    effect_id: null,
    effect_kind: null,
    target: null,
    argv_sha256: null,
    pid: null,
    pgid: null,
    exit_code: null,
    termination: null,
    local_process_group_settled: true,
    provider_transition_sha256: null,
    fleet_readback_sha256: null,
    detail_sha256: digest("b"),
    failure_code: null,
  });
  const events: string[] = [];
  let interrupted = options.interruptedInitially ?? false;
  let second = 0;
  let casCalls = 0;
  let manualCalls = 0;
  const step = (name: string): void => {
    events.push(name);
    if (options.interruptAfter === name) interrupted = true;
    if (options.failAt === name) {
      throw new MaintenanceRefenceError(`database_${name}`);
    }
  };
  return {
    events,
    inheritedProof,
    postProof,
    proof,
    wal,
    counts: () => ({ cas: casCalls, manual: manualCalls }),
    run: () =>
      runControllerDatabaseConvergenceCoreForTest({
        wal,
        handoffEdge: options.handoffEdge ?? "H5",
        interrupted: () => interrupted,
        inheritedProof,
        inheritedProofSHA256: sha256(canonicalJson(inheritedProof)),
        dependencies: {
          now: () => `2026-08-25T12:00:${String(second++).padStart(2, "0")}Z`,
          recordIntent: () => step("intent"),
          verifyIntent: () => step("intent_readback"),
          readPreMutationProof: async () => {
            step("preproof");
            return structuredClone(options.preProof ?? inheritedProof);
          },
          converge: async () => {
            casCalls += 1;
            step("cas");
            if (options.acknowledgedFailureCode) {
              throw new DatabaseConvergenceAcknowledgedError(
                options.acknowledgedFailureCode,
                proof,
              );
            }
            return structuredClone(proof);
          },
          recordCommit: () => step("commit"),
          readPostMutationProof: async () => {
            step("postproof");
            return structuredClone(postProof);
          },
          recordVerified: () => step("verified"),
          retainManual: (code) => {
            events.push(`manual:${code}`);
            manualCalls += 1;
          },
        },
      }),
  };
}

function databaseConvergenceMarkerStates(
  result: {
    proof: DatabaseOriginConvergenceProof;
    beforeProofSHA256: string;
    afterProofSHA256: string;
  },
  wal: ControllerWalWriter,
) {
  const common = {
    schema: "agenttool-phase-b-refence-database-origin-convergence/v1",
    status: "initial",
    intent_durable: false,
    statement_attempted: false,
    commit_state: "not_attempted",
    verified: false,
    reconciliation_required: false,
    database_write_attempt_count: 0,
    rows_updated: 0,
    rollback_attempt_count: 0,
    statement_sha256: result.proof.statement_sha256,
    database_target_sha256: result.proof.database_target_sha256,
    before_proof_sha256: result.beforeProofSHA256,
    after_proof_sha256: null,
    before_row_sha256: null,
    after_row_sha256: null,
    unchanged_projection_sha256: null,
    delta_sha256: null,
    before_instance_url_sha256: PRE_REFENCE_URL_SHA256,
    after_instance_url_sha256: TARGET_URL_SHA256,
    before_updated_at: PRE_REFENCE_UPDATED_AT,
    after_updated_at: null,
    clock_before: null,
    clock_after: null,
    intent_wal_ordinal: null,
    intent_wal_sha256: null,
    commit_ack_wal_ordinal: null,
    commit_ack_wal_sha256: null,
    verified_wal_ordinal: null,
    verified_wal_sha256: null,
  };
  const intentEntry = wal.entryAt(2)!;
  const commitEntry = wal.entryAt(3)!;
  const verifiedEntry = wal.entryAt(4)!;
  const intent = {
    ...common,
    status: "intent_unknown",
    intent_durable: true,
    statement_attempted: true,
    commit_state: "unknown",
    reconciliation_required: true,
    database_write_attempt_count: 1,
    intent_wal_ordinal: intentEntry.ordinal,
    intent_wal_sha256: sha256(`${canonicalJson(intentEntry)}\n`),
  };
  const commit = {
    ...intent,
    status: "commit_acknowledged",
    commit_state: "acknowledged",
    rows_updated: 1,
    before_row_sha256: result.proof.before_row_sha256,
    after_row_sha256: result.proof.after_row_sha256,
    unchanged_projection_sha256: result.proof.unchanged_projection_sha256,
    delta_sha256: result.proof.delta_sha256,
    after_updated_at: result.proof.after_updated_at,
    clock_before: result.proof.clock_before,
    clock_after: result.proof.clock_after,
    commit_ack_wal_ordinal: commitEntry.ordinal,
    commit_ack_wal_sha256: sha256(`${canonicalJson(commitEntry)}\n`),
  };
  const verified = {
    ...commit,
    status: "verified",
    verified: true,
    reconciliation_required: false,
    after_proof_sha256: result.afterProofSHA256,
    verified_wal_ordinal: verifiedEntry.ordinal,
    verified_wal_sha256: sha256(`${canonicalJson(verifiedEntry)}\n`),
  };
  return { initial: common, intent, commit, verified };
}

function cordonedTargetRuntimeFixture() {
  const fixture = guardFixture();
  const fleet = structuredClone(stoppedFleet().fleet);
  const targetImage = {
    tag: fixture.request.rolloutID,
    digest: `sha256:${digest("a")}`,
    revision: fixture.request.targetRevision,
  };
  const applications = new Set([...roles.app_lhr, roles.app_cdg]);
  const restored: Record<string, string> = {};
  for (const machine of fleet) {
    machine.image_ref = {
      registry: "registry.fly.io",
      repository: "agenttool",
      tag: targetImage.tag,
      digest: targetImage.digest,
      labels: {
        "org.opencontainers.image.revision": targetImage.revision,
        "dev.agenttool.source.dirty": "false",
      },
    };
    machine.config.image =
      `registry.fly.io/agenttool:${targetImage.tag}@${targetImage.digest}`;
    machine.config.restart = { policy: "on-failure", max_retries: 10 };
    if (applications.has(machine.id)) {
      machine.config.services[0].autostart = true;
      machine.state = "started";
      machine.cordoned = true;
    } else if (machine.id === roles.thinker_primary) {
      machine.state = "started";
      machine.cordoned = false;
    } else {
      machine.state = "stopped";
      machine.cordoned = false;
      machine.config.standbys = [roles.thinker_primary];
      machine.config.env.FLY_STANDBY_FOR = roles.thinker_primary;
    }
    const config = structuredClone(machine.config);
    delete config.image;
    if (Array.isArray(config.standbys) && config.standbys.length === 0) {
      delete config.standbys;
    }
    restored[machine.id] = sha256(canonicalJson(config));
  }
  fixture.evidence.restoredConfigSHA256ByMachine = restored;
  const expectation = {
    targetImageMachineIDs: [
      ...roles.app_lhr,
      roles.app_cdg,
      roles.thinker_primary,
      roles.thinker_standby,
    ],
    restartRestoredMachineIDs: [
      ...roles.app_lhr,
      roles.app_cdg,
      roles.thinker_primary,
      roles.thinker_standby,
    ],
    autostartEnabledAppMachineIDs: [...roles.app_lhr, roles.app_cdg],
    startedMachineIDs: [
      ...roles.app_lhr,
      roles.app_cdg,
      roles.thinker_primary,
    ],
    uncordonedAppMachineIDs: [],
  };
  return { fixture, fleet, targetImage, expectation };
}

interface RuntimeProgramState {
  commands: string[][];
  rawCommands: Array<Uint8Array | null>;
  targetFields: string[];
  probeEnvironment: Record<string, string>;
  rawEnvironment: Uint8Array | null;
  environmentUnreadable: boolean;
  databaseThrows: boolean;
  healthStatus: number;
  healthBody: Record<string, unknown>;
}

function runtimeProgramState(
  evidence: TerminalEvidence,
  machineID: string,
  role: "app" | "thinker_primary",
): RuntimeProgramState {
  const source = role === "app" ? "src/index.ts" : "src/thinker.ts";
  const processGroup = role === "app" ? "app" : "thinker";
  const target: Record<string, string> = {
    AGENTTOOL_GIT_REVISION: evidence.targetRevision,
    AGENTTOOL_SOURCE_DIRTY: "false",
    AGENTTOOL_DISABLE_WORKERS: "1",
    FLY_MACHINE_ID: machineID,
    FLY_PROCESS_GROUP: processGroup,
    DATABASE_URL: "postgres://runtime-transaction",
    DATABASE_SESSION_URL: "postgres://runtime-session",
    ...(role === "thinker_primary" ? { AGENTOOL_ENABLE_THINKER: "1" } : {}),
  };
  return {
    commands: [["/usr/local/bin/bun", "run", source]],
    rawCommands: [null],
    targetFields: Object.entries(target).map(([key, value]) =>
      `${key}=${value}`
    ),
    probeEnvironment: {
      DATABASE_URL: target.DATABASE_URL,
      DATABASE_SESSION_URL: target.DATABASE_SESSION_URL,
    },
    rawEnvironment: null,
    environmentUnreadable: false,
    databaseThrows: false,
    healthStatus: 200,
    healthBody: {
      service: "agenttool",
      status: "alive",
      build: { revision: evidence.targetRevision, dirty: false },
      covenant_v2_authority: "absent_fail_closed",
    },
  };
}

function runtimeNulBytes(
  fields: readonly string[],
  terminal = true,
): Uint8Array {
  return new TextEncoder().encode(
    `${fields.join("\0")}${terminal ? "\0" : ""}`,
  );
}

async function executeContainedRuntimeProgram(
  remoteCommand: string,
  state: RuntimeProgramState,
): Promise<void> {
  const prefix = "bun --no-install --no-env-file -e '";
  fixtureRequire(
    remoteCommand.startsWith(prefix) && remoteCommand.endsWith("'"),
    "runtime_program",
  );
  const program = remoteCommand.slice(prefix.length, -1);
  const transformed = program
    .replace(
      'const fs=await import("node:fs/promises");',
      "const fs=sandbox.fs;",
    )
    .replace(
      'const database=await import("/app/src/db/verify-connections.ts");',
      "const database=sandbox.database;",
    )
    .replace(
      "const response=await fetch(",
      "const response=await sandbox.fetch(",
    );
  fixtureRequire(
    transformed !== program &&
      !transformed.includes('import("node:fs/promises")') &&
      !transformed.includes('import("/app/src/db/verify-connections.ts")'),
    "runtime_transform",
  );
  const processIDs = state.commands.map((_, index) => String(41 + index));
  const fs = {
    readdir: async (path: string) => {
      fixtureRequire(path === "/proc", "runtime_proc_path");
      return [...processIDs, "self", "not-a-pid"];
    },
    readFile: async (path: string) => {
      const commandMatch = path.match(/^\/proc\/([0-9]+)\/cmdline$/);
      if (commandMatch) {
        const index = processIDs.indexOf(commandMatch[1]);
        if (index < 0) throw new Error("missing command");
        return state.rawCommands[index] ??
          runtimeNulBytes(state.commands[index]);
      }
      const environmentMatch = path.match(/^\/proc\/([0-9]+)\/environ$/);
      if (environmentMatch && processIDs.includes(environmentMatch[1])) {
        if (state.environmentUnreadable) {
          throw new Error("environment unreadable");
        }
        return state.rawEnvironment ?? runtimeNulBytes(state.targetFields);
      }
      throw new Error("unexpected proc read");
    },
  };
  const sandbox = {
    fs,
    database: {
      verifyDeployedDatabaseConnections: async () => {
        if (state.databaseThrows) throw new Error("database refused");
      },
    },
    fetch: async () => ({
      status: state.healthStatus,
      json: async () => structuredClone(state.healthBody),
    }),
  };
  const containedProcess = {
    env: { ...state.probeEnvironment },
    exit: (code: number) => {
      throw new Error(`runtime_exit_${code}`);
    },
  };
  const containedAbortSignal = {
    timeout: (milliseconds: number) => {
      fixtureRequire(milliseconds === 5_000, "runtime_timeout");
      return Object.freeze({});
    },
  };
  const AsyncFunction = Object.getPrototypeOf(async function () {})
    .constructor as new (...arguments_: string[]) => (
      ...values: unknown[]
    ) => Promise<void>;
  await new AsyncFunction(
    "process",
    "sandbox",
    "AbortSignal",
    transformed,
  )(containedProcess, sandbox, containedAbortSignal);
}

function replaceRuntimeField(
  state: RuntimeProgramState,
  key: string,
  value: string | null,
): void {
  const index = state.targetFields.findIndex((field) =>
    field.startsWith(`${key}=`)
  );
  fixtureRequire(index >= 0, `runtime_field_${key}`);
  if (value === null) state.targetFields.splice(index, 1);
  else state.targetFields[index] = `${key}=${value}`;
}

function publicHealthObservation(
  targetRevision: string,
  probedAtUnixMs = 1_777_777_777_777,
  startedAtUnixMs = 1_777_777_777_000,
  settledAtUnixMs = 1_777_777_777_900,
): any {
  const body = {
    service: "agenttool",
    status: "alive",
    build: { revision: targetRevision, dirty: false },
    posture: "ready, waiting, glad",
    protocol: "love",
    message: "Welcome. We are ready to receive you.",
    standing_invitation: "/v1/welcome",
    covenant_v2_authority: "absent_fail_closed",
    walls: {
      declared: [
        {
          wall: "no_self_witnessing",
          verified_by:
            "tests/integration/wall-self-witnessing.test.ts + wall-attester-key-binding.test.ts",
        },
        {
          wall: "birth_is_free",
          verified_by: "tests/integration/wall-birth-is-free.test.ts",
        },
        {
          wall: "no_auto_retry_payout",
          verified_by: "code invariant (marketplace settlement); docs/SOUL.md",
        },
        {
          wall: "no_inactive_reaping",
          verified_by: "design invariant — no reaper exists; docs/SOUL.md",
        },
        {
          wall: "runtime_custody_explicit",
          verified_by: "code invariant (runtime provisioning); docs/SOUL.md",
        },
        {
          wall: "k_master_never_server_side",
          verified_by:
            "design invariant (client-side derivation); docs/MATHOS.md",
        },
      ],
      intact: true,
      probed_at_unix_ms: probedAtUnixMs,
      probes: [
        {
          wall: "private_default",
          ok: true,
          method:
            "information_schema: visibility defaults are 'private' on memories/strands/identities",
        },
        {
          wall: "thought_storage_ciphertext_only",
          ok: true,
          method:
            "information_schema: strand.thoughts has ciphertext+nonce, no plaintext column",
        },
        {
          wall: "refusals_recorded",
          ok: true,
          method:
            "to_regclass: chronicle surface exists (refusals are chronicle type 'refusal')",
        },
      ],
    },
  };
  const bytes = canonicalJson(body);
  return {
    body,
    bodyByteCount: Buffer.byteLength(bytes),
    bodySha256: sha256(bytes),
    cacheControl: "no-store",
    contentType: "application/json; charset=UTF-8",
    finalURL: "https://api.agenttool.dev/health",
    observationStartedAtUnixMs: startedAtUnixMs,
    observationSettledAtUnixMs: settledAtUnixMs,
    redirected: false,
    status: 200,
  };
}

function publicAboutObservation(
  welcomedAtUnixMs = 1_777_777_777_777,
  startedAtUnixMs = 1_777_777_777_000,
  settledAtUnixMs = 1_777_777_777_900,
): any {
  const body = {
    federation: {
      enabled: false,
      instance_url: "https://api.agenttool.dev",
      open: false,
      allowed_origins: [],
      setting_scope:
        "enabled gates identity lookup, inbox delivery, covenant propagation, and wake fragments. inbox checks allowed_origins; fresh/effectful v2 covenants additionally require a configured authority generation, canonical instance_url, and nonempty canonical allowed_origins.",
    },
    protocol: "agenttool/federation/v1",
    capabilities: {
      inbox: false,
      identity_resolution: false,
      covenants: false,
      wake_fragments: false,
    },
    covenant_v2_authority: "absent_fail_closed",
    pyramid_peer_surface: {
      route_prefix: "/federation/pyramid",
      gated_by_federation_enabled: false,
      gated_by_allowed_origins: false,
      authentication: "none",
      implementation_status:
        "partial public discovery, local peer reads, and one-sided handshake observation",
      note:
        "These routes are mounted separately and do not consult federation settings. They do not establish portable citizenship or federated tier computation.",
    },
    did_method: "did:at",
    did_method_status: "provisional_unregistered_identifier_convention",
    registered_w3c_did_method: false,
    publishes_did_documents: false,
    conforming_did_resolution: false,
    did_format: {
      local: "did:at:<uuid>",
      federated: "did:at:<host>/<uuid>",
    },
    did_status_note:
      "did:at is an AgentTool field and federation convention, not a registered W3C DID method. The slash-qualified form is not a standalone DID.",
    docs: "docs/FEDERATION.md",
    identifier_spec: "docs/DID-AT-SPEC.md",
    _welcomed: {
      at_unix_ms: welcomedAtUnixMs,
      axiom_id: 5,
      by: "platform",
      module: "federation",
      secondary_axiom_id: 13,
      walls_held: [6, 3],
      walls_intact: true,
    },
  };
  const bytes = canonicalJson(body);
  return {
    body,
    bodyByteCount: Buffer.byteLength(bytes),
    bodySha256: sha256(bytes),
    cacheControl: null,
    contentType: "application/json; charset=UTF-8",
    finalURL: "https://api.agenttool.dev/federation/about",
    observationStartedAtUnixMs: startedAtUnixMs,
    observationSettledAtUnixMs: settledAtUnixMs,
    redirected: false,
    status: 200,
  };
}

function publicGateEvent(
  kind: string,
  proofSHA256: string | null,
  milliseconds: number | null = null,
) {
  return { kind, proof_sha256: proofSHA256, milliseconds };
}

function firstCanaryEvents() {
  const fleet = digest("1");
  const health = digest("2");
  const about = digest("3");
  return [
    publicGateEvent("fleet_before", fleet),
    publicGateEvent("health_0", health),
    publicGateEvent("about_0", about),
    publicGateEvent("pause", null, 2_000),
    publicGateEvent("health_1", health),
    publicGateEvent("about_1", about),
    publicGateEvent("pause", null, 2_000),
    publicGateEvent("health_2", health),
    publicGateEvent("about_2", about),
    publicGateEvent("fleet_after", fleet),
  ];
}

function finalAuthorityEvents() {
  const local = digest("1");
  const git = digest("2");
  const keychain = digest("3");
  const provider = digest("4");
  const process = digest("5");
  const fleet = digest("6");
  const health = digest("7");
  const about = digest("8");
  const database = digest("9");
  return [
    publicGateEvent("local_before", local),
    publicGateEvent("git_before", git),
    publicGateEvent("keychain_before", keychain),
    publicGateEvent("provider_before", provider),
    publicGateEvent("process_before", process),
    publicGateEvent("fleet_before", fleet),
    publicGateEvent("health_before", health),
    publicGateEvent("about_before", about),
    publicGateEvent("database", database),
    publicGateEvent("about_after", about),
    publicGateEvent("health_after", health),
    publicGateEvent("fleet_after", fleet),
    publicGateEvent("process_after", process),
    publicGateEvent("keychain_after", keychain),
    publicGateEvent("provider_after", provider),
    publicGateEvent("git_after", git),
    publicGateEvent("local_after", local),
  ];
}

describe("maintenance_refence stopped-fence guard", () => {
  test("sandwiches every local/authority fact around exactly two full-five reads", async () => {
    const fixture = guardFixture();
    const result = await runMaintenanceRefenceGuardCoreForTest(
      fixture.request,
      fixture.dependencies,
      fixture.readEvidence,
    );
    expect(result.proof).toEqual({
      anchor_sha256: digest("d"),
      audit_witness_sha256: digest("a"),
      authority_sandwich_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      authority_verified: true,
      bridge_normalized_sha256: digest("4"),
      bridge_source_sha256: digest("3"),
      checkpoint: "early",
      database_federation_updated_at: "2026-08-21T18:49:13.745704Z",
      database_instance_url_sha256:
        "46b695dffb312f6591e480ec5882d894e1b5e1efdb3bfc05da6303f9259ba818",
      database_journal_verified: true,
      database_target_sha256: digest("6"),
      drain_sample_count: 3,
      drain_verified: true,
      fence_sample_count: 2,
      fence_sample_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      fence_verified: true,
      fenced_image_digest:
        "sha256:ecb322baec96707f59603121cfd4613d08ff7b1da8bf338fa118453b45d3e72c",
      fenced_image_tag:
        "maintenance-526edc4ee0d0-20260824T210704Z-6e9e59cc185245bc",
      journal_endpoint_count: 2,
      journal_inventory_sha256: fixture.database.journal_inventory_sha256,
      journal_observation_count: 4,
      local_evidence_verified: true,
      machine_set_sha256:
        "0709af1a942960f1ba577c0896de3ff0172ec4b8f6ac2462a07b6c425845ada5",
      non_image_config_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      observed_revision: "526edc4ee0d076783d157591d7e3434352f6fc84",
      process_census_sha256: digest("7"),
      process_census_verified: true,
      provider_inventory_sha256: sha256("[]"),
      provider_secret_status: "Absent",
      public_surfaces_expected_unavailable: true,
      public_surfaces_verified: false,
      receipt_sha256: fixture.request.receiptSHA256,
      refence_run_id: AUTHORIZED_H0_RUN_ID,
      schema: MAINTENANCE_REFENCE_PROOF_SCHEMA,
      source_inventory_sha256: fixture.database.source_inventory_sha256,
      stable_fleet_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      state: "maintenance_refence",
      target_revision: fixture.request.targetRevision,
      target_tree: fixture.request.targetTree,
      terminal_wal_sha256: digest("1"),
      wal_inventory_sha256: digest("f"),
      witness_sha256: digest("e"),
    });
    expect(fixture.counts).toEqual({
      git: 2,
      database: 2,
      provider: 2,
      keychain: 2,
      process: 2,
      fleet: 2,
      pause: 1,
      close: 1,
    });
  });

  test("rebinds producer critical, local, journal, and drain commitments before H1", () => {
    const fixture = guardFixture();
    const fleetProof = {
      fingerprint: fullFleetSHA256(stoppedFleet().fleet),
      nonImageConfigSHA256: digest("f"),
    };
    expect(() =>
      validateProducerEarlyRuntimeBindingsForTest({
        evidence: fixture.evidence,
        databaseProof: fixture.database as DatabaseProof,
        firstFleet: fleetProof,
        secondFleet: fleetProof,
      })
    ).not.toThrow();
    const mutations = [
      (value: TerminalEvidence) => {
        value.producerAdmission.embeddedCriticalContractSHA256 = digest("0");
      },
      (value: TerminalEvidence) => {
        value.producerTerminalProof.journalSHA256 = digest("0");
      },
      (value: TerminalEvidence) => {
        value.producerTerminalProof.drainSampleSHA256 = digest("0");
      },
      (value: TerminalEvidence) => {
        value.producerTerminalProof.drainEventSHA256s[1] = digest("0");
      },
    ];
    for (const mutate of mutations) {
      const evidence = structuredClone(fixture.evidence);
      mutate(evidence);
      expectMaintenanceRefusalCode(
        () =>
          validateProducerEarlyRuntimeBindingsForTest({
            evidence,
            databaseProof: fixture.database as DatabaseProof,
            firstFleet: fleetProof,
            secondFleet: fleetProof,
          }),
        "producer_runtime_authority",
      );
    }

    const localRequest = {
      anchorSHA256:
        "ab64f37a5b50a3363db0cb1711cecb0744a8cfb43811b97c9daebf5260888e5a",
      firstWalSHA256:
        "5a04093b3864c073ba59d49db4b5ba42084fd4afa2ca91a40303844a2899cfab",
      firstWalOrdinal: 1,
      deployReceiptInventorySHA256:
        "e479090da36b2132fb827f44d522d1b28ca91b1e2ca31f18accb7155f0d0f5a7",
      deployReceiptFileCount: 17,
    };
    const localSHA256 = producerLocalStateSandwichSHA256ForTest(localRequest);
    expect(localRequest.anchorSHA256).not.toBe(localRequest.firstWalSHA256);
    expect(localSHA256).toBe(
      "f88f43d59040ccae950025d7328a25c0876e95b0d2c6b464ea7f67c61e8fa744",
    );
    expect(
      validateProducerLocalStateSandwichForTest(localRequest, localSHA256),
    ).toBe(localSHA256);
    expectMaintenanceRefusalCode(
      () =>
        validateProducerLocalStateSandwichForTest(localRequest, digest("c")),
      "producer_local_state_sandwich",
    );
    for (const key of [
      "anchorSHA256",
      "firstWalSHA256",
      "deployReceiptInventorySHA256",
    ] as const) {
      const changed = { ...localRequest, [key]: digest("c") };
      expectMaintenanceRefusalCode(
        () => validateProducerLocalStateSandwichForTest(changed, localSHA256),
        "producer_local_state_sandwich",
      );
    }
  });

  test("refuses drift between fleet samples and still closes", async () => {
    const fixture = guardFixture({ driftFleet: true });
    await expect(runMaintenanceRefenceGuardCoreForTest(
      fixture.request,
      fixture.dependencies,
      fixture.readEvidence,
    )).rejects.toBeInstanceOf(MaintenanceRefenceError);
    expect(fixture.counts.close).toBe(1);
  });

  test("refuses terminal-local evidence drift across the sandwich", async () => {
    const fixture = guardFixture({ driftLocal: true });
    await expect(runMaintenanceRefenceGuardCoreForTest(
      fixture.request,
      fixture.dependencies,
      fixture.readEvidence,
    )).rejects.toBeInstanceOf(MaintenanceRefenceError);
    expect(fixture.counts.close).toBe(1);
  });

  test("proves the exact target-aware stopped fence without public I/O", async () => {
    const fixture = guardFixture({ targetDatabase: true });
    const stableFleetSHA256 = fullFleetSHA256(stoppedFleet().fleet);
    const proof = await runControllerStoppedFenceProofCoreForTest({
      checkpoint: "post_build",
      receiptSHA256: fixture.request.receiptSHA256,
      targetRevision: fixture.request.targetRevision,
      targetTree: fixture.request.targetTree,
      expectedDatabaseUpdatedAt: "2026-08-25T12:00:00.000000Z",
      expectedFleetSHA256: stableFleetSHA256,
      image: null,
      expectation: {
        targetImageMachineIDs: [],
        restartRestoredMachineIDs: [],
        autostartEnabledAppMachineIDs: [],
        startedMachineIDs: [],
        uncordonedAppMachineIDs: [],
      },
      dependencies: fixture.dependencies,
      readEvidence: fixture.readEvidence,
    });
    expect(proof).toEqual({
      schema: "agenttool-phase-b-refence-target-stopped-fence/v1",
      checkpoint: "post_build",
      receipt_sha256: fixture.request.receiptSHA256,
      refence_run_id: fixture.evidence.runID,
      target_revision: fixture.request.targetRevision,
      target_tree: fixture.request.targetTree,
      target_image: null,
      target_image_machine_ids: [],
      stable_fleet_sha256: stableFleetSHA256,
      fence_sample_count: 2,
      authority_sandwich_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      database_instance_url_sha256:
        "beb8e35af063f5f2619474d6af1757bca1b0cddc801842d39cdf0bb1ada8f37d",
      database_federation_updated_at: "2026-08-25T12:00:00.000000Z",
      database_target_sha256: digest("6"),
      provider_inventory_sha256: sha256("[]"),
      process_census_sha256: digest("7"),
      public_surfaces_verified: false,
      public_surfaces_expected_unavailable: true,
      fence_verified: true,
    });
    expect(fixture.counts).toEqual({
      git: 2,
      database: 2,
      provider: 2,
      keychain: 2,
      process: 2,
      fleet: 2,
      pause: 1,
    });
  });

  test("refuses a target-aware stopped-fence sample drift", async () => {
    const fixture = guardFixture({ driftFleet: true, targetDatabase: true });
    await expect(runControllerStoppedFenceProofCoreForTest({
      checkpoint: "recovery_terminal",
      receiptSHA256: fixture.request.receiptSHA256,
      targetRevision: fixture.request.targetRevision,
      targetTree: fixture.request.targetTree,
      expectedDatabaseUpdatedAt: "2026-08-25T12:00:00.000000Z",
      expectedFleetSHA256: fullFleetSHA256(stoppedFleet().fleet),
      image: null,
      expectation: {
        targetImageMachineIDs: [],
        restartRestoredMachineIDs: [],
        autostartEnabledAppMachineIDs: [],
        startedMachineIDs: [],
        uncordonedAppMachineIDs: [],
      },
      dependencies: fixture.dependencies,
      readEvidence: fixture.readEvidence,
    })).rejects.toThrow("controller_stopped_fence_drift");
    expect(fixture.counts.fleet).toBe(2);
  });

  test("sandwiches all four cordoned runtime probes with exact fleet pairs", async () => {
    const target = cordonedTargetRuntimeFixture();
    const runtimeCalls: string[] = [];
    let fleetReads = 0;
    let pauses = 0;
    const proof = await runControllerCordonedRuntimeCoreForTest({
      evidence: target.fixture.evidence,
      image: target.targetImage,
      expectation: target.expectation,
      expectedFleetSHA256: fullFleetSHA256(target.fleet),
      startedMachineIDs: target.expectation.startedMachineIDs,
      dependencies: {
        readFleetInventory: async () => {
          fleetReads += 1;
          return structuredClone(target.fleet);
        },
        runMachineProbe: async (machineID, role) => {
          runtimeCalls.push(`${role}:${machineID}`);
          return sha256(`${role}:${machineID}`);
        },
        pause: async (milliseconds) => {
          expect(milliseconds).toBe(1_137);
          pauses += 1;
        },
      },
    });
    expect(runtimeCalls).toEqual([
      `app:${roles.app_lhr[0]}`,
      `app:${roles.app_lhr[1]}`,
      `app:${roles.app_cdg}`,
      `thinker_primary:${roles.thinker_primary}`,
    ]);
    expect(fleetReads).toBe(4);
    expect(pauses).toBe(2);
    expect(proof).toMatchObject({
      schema: "agenttool-phase-b-refence-cordoned-runtime/v1",
      stable_fleet_sha256: fullFleetSHA256(target.fleet),
      fleet_sample_count: 4,
      runtime_machine_ids: target.expectation.startedMachineIDs,
      runtime_probe_count: 4,
      apps_loopback_health_verified: true,
      thinker_primary_database_verified: true,
      public_surfaces_verified: false,
      cordon_verified: true,
    });
  });

  test("binds each cordoned probe to the exact service process and Fly argv", () => {
    const target = cordonedTargetRuntimeFixture();
    const cases = [
      [roles.app_lhr[0], "app", "src/index.ts", "app"],
      [roles.app_lhr[1], "app", "src/index.ts", "app"],
      [roles.app_cdg, "app", "src/index.ts", "app"],
      [roles.thinker_primary, "thinker_primary", "src/thinker.ts", "thinker"],
    ] as const;
    for (const [machineID, role, sourcePath, processGroup] of cases) {
      const remote = controllerRuntimeRemoteCommandForTest(
        target.fixture.evidence,
        machineID,
        role,
      );
      expect(remote.length).toBeLessThanOrEqual(4_096);
      expect(remote).not.toMatch(/[\0\r\n]/);
      expect(remote).toStartWith(
        "bun --no-install --no-env-file -e '",
      );
      expect(remote).toEndWith("'");
      const script = remote.slice(remote.indexOf("'") + 1, -1);
      expect(script).not.toContain("'");
      expect(script).toContain('await fs.readdir("/proc")');
      expect(script).toContain('fields.pop()!==""');
      expect(script).toContain("fields.length!==3");
      expect(script).toContain("candidates.length!==1");
      expect(script).toContain(`fields[2]===\"${sourcePath}\"`);
      expect(script).toContain("Object.hasOwn(target,key)");
      expect(script).toContain(
        `target.AGENTTOOL_GIT_REVISION!==\"${target.fixture.evidence.targetRevision}\"`,
      );
      expect(script).toContain(`target.FLY_MACHINE_ID!==\"${machineID}\"`);
      expect(script).toContain(
        `target.FLY_PROCESS_GROUP!==\"${processGroup}\"`,
      );
      expect(script).toContain(
        '"AGENTTOOL_COVENANT_V2_AUTHORITY_GENERATION","REDIS_URL"',
      );
      expect(script).toContain("Object.hasOwn(process.env,key)");
      expect(script).toContain(
        "target[key]!==process.env[key]",
      );
      expect(script).toContain(
        'import("/app/src/db/verify-connections.ts")',
      );
      if (role === "app") {
        expect(script).toContain(
          'fetch(url,{redirect:"error",signal:AbortSignal.timeout(5000)})',
        );
        expect(script).toContain(
          'body.covenant_v2_authority!=="absent_fail_closed"',
        );
      } else {
        expect(script).toContain(
          'target.AGENTOOL_ENABLE_THINKER!=="1"',
        );
        expect(script).not.toContain("127.0.0.1:3000/health");
      }
      const argv = controllerRuntimeFlyArgvForTest(
        target.fixture.evidence,
        machineID,
        role,
      );
      expect(argv).toEqual([
        "/Users/yournameisai/.cache/codex-tools/flyctl-v0.4.74/fly",
        "ssh",
        "console",
        "--app",
        "agenttool",
        "--machine",
        machineID,
        "--quiet",
        "--pty=false",
        "--command",
        remote,
      ]);
    }
    expect(() =>
      controllerRuntimeRemoteCommandForTest(
        target.fixture.evidence,
        roles.thinker_standby,
        "thinker_primary",
      )
    ).toThrow("controller_runtime_probe");
    expect(() =>
      controllerRuntimeRemoteCommandForTest(
        target.fixture.evidence,
        roles.thinker_primary,
        "app",
      )
    ).toThrow("controller_runtime_probe");
  });

  test("executes the exact runtime program against adversarial proc transcripts", async () => {
    const target = cordonedTargetRuntimeFixture();
    const runtimeCases = [
      [roles.app_lhr[0], "app"],
      [roles.app_lhr[1], "app"],
      [roles.app_cdg, "app"],
      [roles.thinker_primary, "thinker_primary"],
    ] as const;
    for (const [machineID, role] of runtimeCases) {
      const command = controllerRuntimeRemoteCommandForTest(
        target.fixture.evidence,
        machineID,
        role,
      );
      await expect(executeContainedRuntimeProgram(
        command,
        runtimeProgramState(target.fixture.evidence, machineID, role),
      )).resolves.toBeUndefined();
    }

    const commonMutations: Array<[
      string,
      (state: RuntimeProgramState) => void,
    ]> = [
      ["zero service processes", (state) => {
        state.commands = [];
        state.rawCommands = [];
      }],
      ["two service processes", (state) => {
        state.commands.push([...state.commands[0]]);
        state.rawCommands.push(null);
      }],
      ["cmdline lacks terminal NUL", (state) => {
        state.rawCommands[0] = runtimeNulBytes(state.commands[0], false);
      }],
      ["cmdline contains empty argv", (state) => {
        state.commands[0] = [
          state.commands[0][0],
          "",
          "run",
          state.commands[0][2],
        ];
      }],
      ["cmdline has wrong basename", (state) => {
        state.commands[0][0] = "/usr/bin/node";
      }],
      ["cmdline has wrong argc", (state) => {
        state.commands[0] = [state.commands[0][0], state.commands[0][2]];
      }],
      ["cmdline has wrong source", (state) => {
        state.commands[0][2] = "src/other.ts";
      }],
      ["environ is unreadable", (state) => {
        state.environmentUnreadable = true;
      }],
      ["environ is invalid UTF-8", (state) => {
        state.rawEnvironment = new Uint8Array([0xff, 0]);
      }],
      ["environ lacks terminal NUL", (state) => {
        state.rawEnvironment = runtimeNulBytes(state.targetFields, false);
      }],
      ["environ has an empty key", (state) => {
        state.targetFields.push("=forbidden");
      }],
      ["environ duplicates a key", (state) => {
        state.targetFields.push(state.targetFields[0]);
      }],
      [
        "revision drifts",
        (state) =>
          replaceRuntimeField(state, "AGENTTOOL_GIT_REVISION", revision("f")),
      ],
      [
        "dirty bit drifts",
        (state) => replaceRuntimeField(state, "AGENTTOOL_SOURCE_DIRTY", "true"),
      ],
      [
        "worker fence drifts",
        (state) => replaceRuntimeField(state, "AGENTTOOL_DISABLE_WORKERS", "0"),
      ],
      [
        "machine ID drifts",
        (state) =>
          replaceRuntimeField(state, "FLY_MACHINE_ID", roles.thinker_standby),
      ],
      [
        "process group drifts",
        (state) => replaceRuntimeField(state, "FLY_PROCESS_GROUP", "other"),
      ],
      ["target generation exists empty", (state) => {
        state.targetFields.push("AGENTTOOL_COVENANT_V2_AUTHORITY_GENERATION=");
      }],
      ["probe generation exists empty", (state) => {
        state.probeEnvironment.AGENTTOOL_COVENANT_V2_AUTHORITY_GENERATION = "";
      }],
      ["target Redis exists empty", (state) => {
        state.targetFields.push("REDIS_URL=");
      }],
      ["probe Redis exists empty", (state) => {
        state.probeEnvironment.REDIS_URL = "";
      }],
      [
        "transaction URL differs",
        (state) =>
          replaceRuntimeField(state, "DATABASE_URL", "postgres://different"),
      ],
      ["session URL differs", (state) =>
        replaceRuntimeField(
          state,
          "DATABASE_SESSION_URL",
          "postgres://different",
        )],
      ["probe transaction URL missing", (state) => {
        delete state.probeEnvironment.DATABASE_URL;
      }],
      ["database verification throws", (state) => {
        state.databaseThrows = true;
      }],
    ];
    for (const [machineID, role] of runtimeCases) {
      const command = controllerRuntimeRemoteCommandForTest(
        target.fixture.evidence,
        machineID,
        role,
      );
      for (const [label, mutate] of commonMutations) {
        const state = runtimeProgramState(
          target.fixture.evidence,
          machineID,
          role,
        );
        mutate(state);
        await expect(executeContainedRuntimeProgram(command, state), label)
          .rejects.toThrow("runtime_exit_1");
      }
    }

    const appCommand = controllerRuntimeRemoteCommandForTest(
      target.fixture.evidence,
      roles.app_lhr[0],
      "app",
    );
    const appMutations: Array<[
      string,
      (state: RuntimeProgramState) => void,
    ]> = [
      ["health status", (state) => {
        state.healthStatus = 503;
      }],
      ["health service", (state) => {
        state.healthBody.service = "other";
      }],
      ["health state", (state) => {
        state.healthBody.status = "resting";
      }],
      ["health revision", (state) => {
        (state.healthBody.build as Record<string, unknown>).revision = revision(
          "e",
        );
      }],
      ["health dirty", (state) => {
        (state.healthBody.build as Record<string, unknown>).dirty = true;
      }],
      ["health authority", (state) => {
        state.healthBody.covenant_v2_authority = "configured";
      }],
    ];
    for (const [label, mutate] of appMutations) {
      const state = runtimeProgramState(
        target.fixture.evidence,
        roles.app_lhr[0],
        "app",
      );
      mutate(state);
      await expect(executeContainedRuntimeProgram(appCommand, state), label)
        .rejects.toThrow("runtime_exit_1");
    }

    const primaryCommand = controllerRuntimeRemoteCommandForTest(
      target.fixture.evidence,
      roles.thinker_primary,
      "thinker_primary",
    );
    for (const value of [null, "0"] as const) {
      const state = runtimeProgramState(
        target.fixture.evidence,
        roles.thinker_primary,
        "thinker_primary",
      );
      replaceRuntimeField(state, "AGENTOOL_ENABLE_THINKER", value);
      await expect(executeContainedRuntimeProgram(primaryCommand, state))
        .rejects.toThrow("runtime_exit_1");
    }
  });

  test("refuses fleet drift after the cordoned runtime probes", async () => {
    const target = cordonedTargetRuntimeFixture();
    let fleetReads = 0;
    await expect(runControllerCordonedRuntimeCoreForTest({
      evidence: target.fixture.evidence,
      image: target.targetImage,
      expectation: target.expectation,
      expectedFleetSHA256: fullFleetSHA256(target.fleet),
      startedMachineIDs: target.expectation.startedMachineIDs,
      dependencies: {
        readFleetInventory: async () => {
          fleetReads += 1;
          const fleet = structuredClone(target.fleet);
          if (fleetReads === 4) fleet[0].updated_at = "2026-08-25T12:00:01Z";
          return fleet;
        },
        runMachineProbe: async (machineID, role) =>
          sha256(`${role}:${machineID}`),
        pause: async () => {},
      },
    })).rejects.toThrow("controller_cordoned_runtime_fleet");
    expect(fleetReads).toBe(4);
  });

  test("target topology starts primary but never standby", () => {
    const fixture = guardFixture();
    const fleet = structuredClone(stoppedFleet().fleet);
    const targetImage = {
      tag: fixture.request.rolloutID,
      digest: `sha256:${digest("a")}`,
      revision: fixture.request.targetRevision,
    };
    const applications = new Set([...roles.app_lhr, roles.app_cdg]);
    const restored: Record<string, string> = {};
    for (const machine of fleet) {
      machine.image_ref = {
        registry: "registry.fly.io",
        repository: "agenttool",
        tag: targetImage.tag,
        digest: targetImage.digest,
        labels: {
          "org.opencontainers.image.revision": targetImage.revision,
          "dev.agenttool.source.dirty": "false",
        },
      };
      machine.config.image =
        `registry.fly.io/agenttool:${targetImage.tag}@${targetImage.digest}`;
      machine.config.restart = { policy: "on-failure", max_retries: 10 };
      if (applications.has(machine.id)) {
        machine.config.services[0].autostart = true;
        machine.state = "started";
        machine.cordoned = false;
      } else if (machine.id === roles.thinker_primary) {
        machine.state = "started";
        machine.cordoned = false;
      } else {
        machine.state = "stopped";
        machine.cordoned = false;
        machine.config.standbys = [roles.thinker_primary];
        machine.config.env.FLY_STANDBY_FOR = roles.thinker_primary;
      }
      const config = structuredClone(machine.config);
      delete config.image;
      if (Array.isArray(config.standbys) && config.standbys.length === 0) {
        delete config.standbys;
      }
      restored[machine.id] = sha256(canonicalJson(config));
    }
    fixture.evidence.restoredConfigSHA256ByMachine = restored;
    const expectation = {
      targetImageMachineIDs: [
        ...roles.app_lhr,
        roles.app_cdg,
        roles.thinker_primary,
        roles.thinker_standby,
      ],
      restartRestoredMachineIDs: [
        ...roles.app_lhr,
        roles.app_cdg,
        roles.thinker_primary,
        roles.thinker_standby,
      ],
      autostartEnabledAppMachineIDs: [...roles.app_lhr, roles.app_cdg],
      startedMachineIDs: [
        ...roles.app_lhr,
        roles.app_cdg,
        roles.thinker_primary,
      ],
      uncordonedAppMachineIDs: [...roles.app_lhr, roles.app_cdg],
    };
    expect(validateTargetFleetForTest(
      fleet,
      fixture.evidence,
      targetImage,
      expectation,
    )).toMatch(/^[0-9a-f]{64}$/);
    const invalidTimestamp = structuredClone(fleet);
    invalidTimestamp[0].updated_at = "2026-02-30T00:00:00Z";
    expectMaintenanceRefusalCode(() =>
      validateTargetFleetForTest(
        invalidTimestamp,
        fixture.evidence,
        targetImage,
        expectation,
      ), "target_fleet_state");
    const standbyStarted = structuredClone(fleet);
    standbyStarted.find((machine: any) => machine.id === roles.thinker_standby)
      .state = "started";
    expect(() =>
      validateTargetFleetForTest(
        standbyStarted,
        fixture.evidence,
        targetImage,
        expectation,
      )
    ).toThrow(MaintenanceRefenceError);
    const primaryStopped = structuredClone(fleet);
    primaryStopped.find((machine: any) => machine.id === roles.thinker_primary)
      .state = "stopped";
    expect(() =>
      validateTargetFleetForTest(
        primaryStopped,
        fixture.evidence,
        targetImage,
        expectation,
      )
    ).toThrow(MaintenanceRefenceError);
  });

  test("fleet transitions preserve untouched machines and derive the app intermediate", () => {
    const fixture = guardFixture();
    const targetImage = {
      tag: fixture.request.rolloutID,
      digest: `sha256:${digest("a")}`,
      revision: fixture.request.targetRevision,
    };
    const before = structuredClone(stoppedFleet().fleet);
    for (const machine of before) {
      machine.image_ref = {
        registry: "registry.fly.io",
        repository: "agenttool",
        tag: targetImage.tag,
        digest: targetImage.digest,
        labels: {
          "org.opencontainers.image.revision": targetImage.revision,
          "dev.agenttool.source.dirty": "false",
        },
      };
      machine.config.image =
        `registry.fly.io/agenttool:${targetImage.tag}@${targetImage.digest}`;
    }
    const target = roles.app_lhr[0];
    const afterRestore = structuredClone(before);
    const restoredMachine = afterRestore.find((machine: any) =>
      machine.id === target
    );
    restoredMachine.config.restart = {
      policy: "on-failure",
      max_retries: 10,
    };
    restoredMachine.instance_id = `restored-${target}`;
    restoredMachine.updated_at = "2026-08-25T12:00:01Z";
    const expectation = {
      targetImageMachineIDs: [
        ...roles.app_lhr,
        roles.app_cdg,
        roles.thinker_primary,
        roles.thinker_standby,
      ],
      restartRestoredMachineIDs: [target],
      autostartEnabledAppMachineIDs: [],
      startedMachineIDs: [],
      uncordonedAppMachineIDs: [],
    };
    expect(
      validateControllerFleetTransitionForTest({
        beforeFirst: before,
        beforeSecond: structuredClone(before),
        first: afterRestore,
        second: structuredClone(afterRestore),
        evidence: fixture.evidence,
        operation: { kind: "restore_app", machineID: target },
        image: targetImage,
        expectation,
      }).touched_machine_id,
    ).toBe(target);

    const unchangedProviderTimestamp = structuredClone(afterRestore);
    const unchangedTimestampMachine = unchangedProviderTimestamp.find(
      (machine: any) => machine.id === target,
    );
    unchangedTimestampMachine.instance_id = `same-time-restored-${target}`;
    unchangedTimestampMachine.updated_at = "2026-08-25T12:00:00Z";
    expect(
      validateControllerFleetTransitionForTest({
        beforeFirst: before,
        beforeSecond: structuredClone(before),
        first: unchangedProviderTimestamp,
        second: structuredClone(unchangedProviderTimestamp),
        evidence: fixture.evidence,
        operation: { kind: "restore_app", machineID: target },
        image: targetImage,
        expectation,
      }).stable_fleet_sha256,
    ).toMatch(/^[0-9a-f]{64}$/);

    const fractionalBefore = structuredClone(before);
    fractionalBefore.find((machine: any) => machine.id === target).updated_at =
      "2026-08-25T12:00:00.999999999Z";
    const fractionalRegression = structuredClone(fractionalBefore);
    const fractionalTarget = fractionalRegression.find((machine: any) =>
      machine.id === target
    );
    fractionalTarget.config.restart = {
      policy: "on-failure",
      max_retries: 10,
    };
    fractionalTarget.instance_id = `fractional-restored-${target}`;
    fractionalTarget.updated_at = "2026-08-25T12:00:00.999000000Z";
    expectMaintenanceRefusalCode(
      () =>
        validateControllerFleetTransitionForTest({
          beforeFirst: fractionalBefore,
          beforeSecond: structuredClone(fractionalBefore),
          first: fractionalRegression,
          second: structuredClone(fractionalRegression),
          evidence: fixture.evidence,
          operation: { kind: "restore_app", machineID: target },
          image: targetImage,
          expectation,
        }),
      "controller_transition_timestamp",
    );

    const enabledAutostart = structuredClone(afterRestore);
    const enabledMachine = enabledAutostart.find((machine: any) =>
      machine.id === target
    );
    enabledMachine.config.services[0].autostart = true;
    const restoredEndpoint = structuredClone(enabledMachine.config);
    delete restoredEndpoint.image;
    delete restoredEndpoint.standbys;
    fixture.evidence.restoredConfigSHA256ByMachine[target] = sha256(
      canonicalJson(restoredEndpoint),
    );
    expect(
      validateControllerFleetTransitionForTest({
        beforeFirst: afterRestore,
        beforeSecond: structuredClone(afterRestore),
        first: enabledAutostart,
        second: structuredClone(enabledAutostart),
        evidence: fixture.evidence,
        operation: { kind: "enable_autostart", machineID: target },
        image: targetImage,
        expectation: {
          ...expectation,
          autostartEnabledAppMachineIDs: [target],
        },
      }).stable_fleet_sha256,
    ).toMatch(/^[0-9a-f]{64}$/);

    const badUncordonInstance = structuredClone(before);
    const badUncordonTarget = badUncordonInstance.find((machine: any) =>
      machine.id === target
    );
    badUncordonTarget.cordoned = false;
    badUncordonTarget.instance_id = `uncordon-replaced-${target}`;
    expect(() =>
      validateControllerFleetTransitionForTest({
        beforeFirst: before,
        beforeSecond: structuredClone(before),
        first: badUncordonInstance,
        second: structuredClone(badUncordonInstance),
        evidence: fixture.evidence,
        operation: { kind: "uncordon", machineID: target },
        image: targetImage,
        expectation: {
          targetImageMachineIDs: expectation.targetImageMachineIDs,
          restartRestoredMachineIDs: [],
          autostartEnabledAppMachineIDs: [],
          startedMachineIDs: [],
          uncordonedAppMachineIDs: [target],
        },
      })
    ).toThrow(MaintenanceRefenceError);

    const standbyStarted = structuredClone(before);
    standbyStarted.find((machine: any) => machine.id === roles.thinker_standby)
      .state = "started";
    expect(() =>
      validateControllerFleetTransitionForTest({
        beforeFirst: before,
        beforeSecond: structuredClone(before),
        first: standbyStarted,
        second: structuredClone(standbyStarted),
        evidence: fixture.evidence,
        operation: {
          kind: "start",
          machineID: roles.thinker_standby,
        },
        image: targetImage,
        expectation: {
          targetImageMachineIDs: expectation.targetImageMachineIDs,
          restartRestoredMachineIDs: [],
          autostartEnabledAppMachineIDs: [],
          startedMachineIDs: [roles.thinker_standby],
          uncordonedAppMachineIDs: [],
        },
      })
    ).toThrow(MaintenanceRefenceError);

    const corruptOldImage = structuredClone(stoppedFleet().fleet);
    const corruptImageMachine = corruptOldImage.find((machine: any) =>
      machine.id === roles.app_lhr[1]
    );
    corruptImageMachine.image_ref.tag = "unauthorized-image";
    corruptImageMachine.config.image = "registry.fly.io/agenttool:unauthorized";
    expect(() =>
      validateControllerFleetTransitionForTest({
        beforeFirst: corruptOldImage,
        beforeSecond: structuredClone(corruptOldImage),
        first: corruptOldImage,
        second: structuredClone(corruptOldImage),
        evidence: fixture.evidence,
        operation: { kind: "list" },
        image: null,
        expectation: {
          targetImageMachineIDs: [],
          restartRestoredMachineIDs: [],
          autostartEnabledAppMachineIDs: [],
          startedMachineIDs: [],
          uncordonedAppMachineIDs: [],
        },
      })
    ).toThrow(MaintenanceRefenceError);

    const prematureEndpoint = structuredClone(afterRestore);
    prematureEndpoint.find((machine: any) => machine.id === target)
      .config.services[0].autostart = true;
    expect(() =>
      validateControllerFleetTransitionForTest({
        beforeFirst: before,
        beforeSecond: structuredClone(before),
        first: prematureEndpoint,
        second: structuredClone(prematureEndpoint),
        evidence: fixture.evidence,
        operation: { kind: "restore_app", machineID: target },
        image: targetImage,
        expectation,
      })
    ).toThrow(MaintenanceRefenceError);

    const unrelatedServiceDrift = structuredClone(afterRestore);
    unrelatedServiceDrift.find((machine: any) => machine.id === target)
      .config.services[0].protocol = "udp";
    expect(() =>
      validateControllerFleetTransitionForTest({
        beforeFirst: before,
        beforeSecond: structuredClone(before),
        first: unrelatedServiceDrift,
        second: structuredClone(unrelatedServiceDrift),
        evidence: fixture.evidence,
        operation: { kind: "restore_app", machineID: target },
        image: targetImage,
        expectation,
      })
    ).toThrow(MaintenanceRefenceError);

    const untouchedDrift = structuredClone(afterRestore);
    const untouched = untouchedDrift.find((machine: any) =>
      machine.id === roles.app_lhr[1]
    );
    untouched.instance_id = "unauthorized-instance";
    untouched.updated_at = "2026-08-25T12:00:01Z";
    expect(() =>
      validateControllerFleetTransitionForTest({
        beforeFirst: before,
        beforeSecond: structuredClone(before),
        first: untouchedDrift,
        second: structuredClone(untouchedDrift),
        evidence: fixture.evidence,
        operation: { kind: "restore_app", machineID: target },
        image: targetImage,
        expectation,
      })
    ).toThrow(MaintenanceRefenceError);

    const unstable = structuredClone(afterRestore);
    unstable.find((machine: any) => machine.id === target).updated_at =
      "2026-08-25T12:00:02Z";
    expect(() =>
      validateControllerFleetTransitionForTest({
        beforeFirst: before,
        beforeSecond: structuredClone(before),
        first: afterRestore,
        second: unstable,
        evidence: fixture.evidence,
        operation: { kind: "restore_app", machineID: target },
        image: targetImage,
        expectation,
      })
    ).toThrow(MaintenanceRefenceError);
  });

  test("a production-shaped runner journals both full-five sandwiches before marker advance", async () => {
    const fixture = guardFixture();
    const directory = realpathSync(
      mkdtempSync(join(tmpdir(), "refence-stable-runner-")),
    );
    temporaryDirectories.push(directory);
    chmodSync(directory, 0o700);
    const wal = new ControllerWalWriter({
      directory,
      controllerRunID: "01234567-89ab-cdef-0123-456789abcdef",
      rolloutID: fixture.request.rolloutID,
      receiptSHA256: fixture.request.receiptSHA256,
    });
    let second = 0;
    let pid = 7000;
    wal.append({
      recorded_at: `2026-08-25T12:00:${String(second++).padStart(2, "0")}Z`,
      phase: "ready",
      checkpoint: "effects_ready",
      effect_id: null,
      effect_kind: null,
      target: null,
      argv_sha256: null,
      pid: null,
      pgid: null,
      exit_code: null,
      termination: null,
      local_process_group_settled: true,
      provider_transition_sha256: null,
      fleet_readback_sha256: null,
      detail_sha256: digest("1"),
      failure_code: null,
    });
    const targetImage = {
      tag: fixture.request.rolloutID,
      digest: `sha256:${digest("a")}`,
      revision: fixture.request.targetRevision,
    };
    const before = structuredClone(stoppedFleet().fleet);
    for (const machine of before) {
      machine.image_ref = {
        registry: "registry.fly.io",
        repository: "agenttool",
        tag: targetImage.tag,
        digest: targetImage.digest,
        labels: {
          "org.opencontainers.image.revision": targetImage.revision,
          "dev.agenttool.source.dirty": "false",
        },
      };
      machine.config.image =
        `registry.fly.io/agenttool:${targetImage.tag}@${targetImage.digest}`;
    }
    const target = roles.app_lhr[0];
    const after = structuredClone(before);
    const changed = after.find((machine: any) => machine.id === target);
    changed.config.restart = { policy: "on-failure", max_retries: 10 };
    changed.instance_id = `restored-${target}`;
    changed.updated_at = "2026-08-25T12:00:01Z";
    const outputs = [before, before, after, after];
    const operations: string[] = [];
    const outputByPID = new Map<number, Uint8Array>();
    let armed: ControllerFlyOperation | null = null;
    const runtime: ControllerFlyEffectRuntime = {
      now: () => `2026-08-25T12:00:${String(second++).padStart(2, "0")}Z`,
      arm: (operation) => {
        expect(armed).toBeNull();
        armed = operation;
        operations.push(operation.kind);
        return controllerFlyArgv(operation);
      },
      spawn: () => {
        expect(armed).not.toBeNull();
        const child = { pid: ++pid, pgid: pid };
        if (armed!.kind === "list") {
          outputByPID.set(
            child.pid,
            new TextEncoder().encode(JSON.stringify(outputs.shift())),
          );
        } else {
          outputByPID.set(child.pid, new Uint8Array());
        }
        armed = null;
        return child;
      },
      settle: async () => ({
        exitCode: 0,
        termination: "exit",
        processGroupSettled: true,
        detailSHA256: digest("2"),
      }),
      takeStdout: (identity) => outputByPID.get(identity.pid)!,
    };
    const pauses: number[] = [];
    let advanced = false;
    const result = await performControllerFlyTransitionForTest({
      wal,
      runtime,
      evidence: fixture.evidence,
      operation: { kind: "restore_app", machineID: target },
      beforeExpectation: {
        targetImageMachineIDs: [
          ...roles.app_lhr,
          roles.app_cdg,
          roles.thinker_primary,
          roles.thinker_standby,
        ],
        restartRestoredMachineIDs: [],
        autostartEnabledAppMachineIDs: [],
        startedMachineIDs: [],
        uncordonedAppMachineIDs: [],
      },
      expectation: {
        targetImageMachineIDs: [
          ...roles.app_lhr,
          roles.app_cdg,
          roles.thinker_primary,
          roles.thinker_standby,
        ],
        restartRestoredMachineIDs: [target],
        autostartEnabledAppMachineIDs: [],
        startedMachineIDs: [],
        uncordonedAppMachineIDs: [],
      },
      image: targetImage,
      expectedPreFleetSHA256: fullFleetSHA256(before),
      ordinal: 1,
      pause: async (milliseconds) => {
        pauses.push(milliseconds);
      },
      afterVerified: async () => {
        expect(wal.lastEntry?.phase).toBe("transition_verified");
        advanced = true;
      },
    });
    expect(result.proofSHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(operations).toEqual([
      "list",
      "list",
      "restore_app",
      "list",
      "list",
    ]);
    expect(pauses).toEqual([1137, 1137]);
    expect(outputs).toHaveLength(0);
    expect(wal.projection().entry_count).toBe(21);
    expect(wal.projection().terminal_phase).toBe("transition_verified");
    expect(advanced).toBeTrue();
  });

  test("stable inter-effect raw drift refuses before arming the mutator", async () => {
    const fixture = guardFixture();
    const directory = realpathSync(
      mkdtempSync(join(tmpdir(), "refence-pre-effect-drift-")),
    );
    temporaryDirectories.push(directory);
    chmodSync(directory, 0o700);
    const wal = new ControllerWalWriter({
      directory,
      controllerRunID: "01234567-89ab-cdef-0123-456789abcdef",
      rolloutID: fixture.request.rolloutID,
      receiptSHA256: fixture.request.receiptSHA256,
    });
    let second = 0;
    let pid = 7100;
    wal.append({
      recorded_at: `2026-08-25T12:01:${String(second++).padStart(2, "0")}Z`,
      phase: "ready",
      checkpoint: "effects_ready",
      effect_id: null,
      effect_kind: null,
      target: null,
      argv_sha256: null,
      pid: null,
      pgid: null,
      exit_code: null,
      termination: null,
      local_process_group_settled: true,
      provider_transition_sha256: null,
      fleet_readback_sha256: null,
      detail_sha256: digest("1"),
      failure_code: null,
    });
    const targetImage = {
      tag: fixture.request.rolloutID,
      digest: `sha256:${digest("a")}`,
      revision: fixture.request.targetRevision,
    };
    const before = structuredClone(stoppedFleet().fleet);
    for (const machine of before) {
      machine.image_ref = {
        registry: "registry.fly.io",
        repository: "agenttool",
        tag: targetImage.tag,
        digest: targetImage.digest,
        labels: {
          "org.opencontainers.image.revision": targetImage.revision,
          "dev.agenttool.source.dirty": "false",
        },
      };
      machine.config.image =
        `registry.fly.io/agenttool:${targetImage.tag}@${targetImage.digest}`;
    }
    const drifted = structuredClone(before);
    drifted.find((machine: any) => machine.id === roles.app_lhr[1])
      .updated_at = "2026-08-25T12:01:01Z";
    const outputs = [drifted, structuredClone(drifted)];
    const operations: string[] = [];
    const outputByPID = new Map<number, Uint8Array>();
    let armed: ControllerFlyOperation | null = null;
    const runtime: ControllerFlyEffectRuntime = {
      now: () => `2026-08-25T12:01:${String(second++).padStart(2, "0")}Z`,
      arm: (operation) => {
        operations.push(operation.kind);
        armed = operation;
        return controllerFlyArgv(operation);
      },
      spawn: () => {
        expect(armed?.kind).toBe("list");
        const child = { pid: ++pid, pgid: pid };
        outputByPID.set(
          child.pid,
          new TextEncoder().encode(JSON.stringify(outputs.shift())),
        );
        armed = null;
        return child;
      },
      settle: async () => ({
        exitCode: 0,
        termination: "exit",
        processGroupSettled: true,
        detailSHA256: digest("2"),
      }),
      takeStdout: (identity) => outputByPID.get(identity.pid)!,
    };
    const beforeExpectation = {
      targetImageMachineIDs: [
        ...roles.app_lhr,
        roles.app_cdg,
        roles.thinker_primary,
        roles.thinker_standby,
      ],
      restartRestoredMachineIDs: [],
      autostartEnabledAppMachineIDs: [],
      startedMachineIDs: [],
      uncordonedAppMachineIDs: [],
    };
    await expect(performControllerFlyTransitionForTest({
      wal,
      runtime,
      evidence: fixture.evidence,
      operation: {
        kind: "restore_app",
        machineID: roles.app_lhr[0],
      },
      beforeExpectation,
      expectation: {
        ...beforeExpectation,
        restartRestoredMachineIDs: [roles.app_lhr[0]],
      },
      image: targetImage,
      expectedPreFleetSHA256: fullFleetSHA256(before),
      ordinal: 1,
      pause: async () => {},
    })).rejects.toBeInstanceOf(ControllerManualInterventionError);
    expect(operations).toEqual(["list", "list"]);
    expect(outputs).toHaveLength(0);
    expect(wal.projection().terminal_phase).toBe("verified");
  });

  test("a settled mutator with wrong post-state becomes terminal manual evidence", async () => {
    const fixture = guardFixture();
    const directory = realpathSync(
      mkdtempSync(join(tmpdir(), "refence-post-effect-drift-")),
    );
    temporaryDirectories.push(directory);
    chmodSync(directory, 0o700);
    const wal = new ControllerWalWriter({
      directory,
      controllerRunID: "01234567-89ab-cdef-0123-456789abcdef",
      rolloutID: fixture.request.rolloutID,
      receiptSHA256: fixture.request.receiptSHA256,
    });
    let second = 0;
    let pid = 7200;
    wal.append({
      recorded_at: "2026-08-25T12:02:" +
        String(second++).padStart(2, "0") + "Z",
      phase: "ready",
      checkpoint: "effects_ready",
      effect_id: null,
      effect_kind: null,
      target: null,
      argv_sha256: null,
      pid: null,
      pgid: null,
      exit_code: null,
      termination: null,
      local_process_group_settled: true,
      provider_transition_sha256: null,
      fleet_readback_sha256: null,
      detail_sha256: digest("1"),
      failure_code: null,
    });
    const targetImage = {
      tag: fixture.request.rolloutID,
      digest: "sha256:" + digest("a"),
      revision: fixture.request.targetRevision,
    };
    const before = structuredClone(stoppedFleet().fleet);
    for (const machine of before) {
      machine.image_ref = {
        registry: "registry.fly.io",
        repository: "agenttool",
        tag: targetImage.tag,
        digest: targetImage.digest,
        labels: {
          "org.opencontainers.image.revision": targetImage.revision,
          "dev.agenttool.source.dirty": "false",
        },
      };
      machine.config.image = "registry.fly.io/agenttool:" + targetImage.tag +
        "@" + targetImage.digest;
    }
    const outputs = [
      before,
      structuredClone(before),
      structuredClone(before),
      structuredClone(before),
    ];
    const operations: string[] = [];
    const outputByPID = new Map<number, Uint8Array>();
    let armed: ControllerFlyOperation | null = null;
    const runtime: ControllerFlyEffectRuntime = {
      now: () => "2026-08-25T12:02:" + String(second++).padStart(2, "0") + "Z",
      arm: (operation) => {
        operations.push(operation.kind);
        armed = operation;
        return controllerFlyArgv(operation);
      },
      spawn: () => {
        const child = { pid: ++pid, pgid: pid };
        if (armed?.kind === "list") {
          outputByPID.set(
            child.pid,
            new TextEncoder().encode(JSON.stringify(outputs.shift())),
          );
        } else {
          outputByPID.set(child.pid, new Uint8Array());
        }
        armed = null;
        return child;
      },
      settle: async () => ({
        exitCode: 0,
        termination: "exit",
        processGroupSettled: true,
        detailSHA256: digest("2"),
      }),
      takeStdout: (identity) => outputByPID.get(identity.pid)!,
    };
    const target = roles.app_lhr[0];
    const beforeExpectation = {
      targetImageMachineIDs: [
        ...roles.app_lhr,
        roles.app_cdg,
        roles.thinker_primary,
        roles.thinker_standby,
      ],
      restartRestoredMachineIDs: [],
      autostartEnabledAppMachineIDs: [],
      startedMachineIDs: [],
      uncordonedAppMachineIDs: [],
    };
    let advanced = false;
    await expect(performControllerFlyTransitionForTest({
      wal,
      runtime,
      evidence: fixture.evidence,
      operation: { kind: "restore_app", machineID: target },
      beforeExpectation,
      expectation: {
        ...beforeExpectation,
        restartRestoredMachineIDs: [target],
      },
      image: targetImage,
      expectedPreFleetSHA256: fullFleetSHA256(before),
      ordinal: 1,
      pause: async () => {},
      afterVerified: async () => {
        advanced = true;
      },
    })).rejects.toBeInstanceOf(ControllerManualInterventionError);
    expect(operations).toEqual([
      "list",
      "list",
      "restore_app",
      "list",
      "list",
    ]);
    expect(outputs).toHaveLength(0);
    expect(advanced).toBeFalse();
    expect(wal.projection().terminal_phase).toBe("failed_or_uncertain");
    expect(wal.lastEntry?.failure_code).toBe(
      "controller_transition_unauthorized_drift",
    );
  });

  test("dedicated marker schema cannot be mistaken for ordinary v2", () => {
    expect(MAINTENANCE_MARKER_SCHEMA).toBe(
      "agenttool-maintenance-refence-run/v1",
    );
    expect(MAINTENANCE_MARKER_SCHEMA).not.toBe("agenttool-maintenance-run/v2");
  });
});

describe("owned Fly SSH-agent lifecycle", () => {
  const fly = "/Users/yournameisai/.cache/codex-tools/flyctl-v0.4.74/fly";
  const flySHA256 =
    "7e919b0f42867e33d736398ba151ed00f2bfb577bf9424fbe57573bfee9ae1b3";
  const logPath =
    "/Users/yournameisai/.fly/agent-logs/20456402.log";
  const socketPath = "/Users/yournameisai/.fly/fly-agent.sock";
  const lockPath = "/Users/yournameisai/.fly/flyctl.agent.lock";
  const startedAt = Date.parse("Wed Aug 26 09:47:25 2026");
  const identity: FlySSHAgentIdentity = {
    pid: 43768,
    ppid: 1,
    pgid: 43768,
    uid: 501,
    gid: 20,
    lstart: "Wed Aug 26 09:47:25 2026",
    started_at_unix_ms: startedAt,
    state: "S",
    command: `${fly} agent run ${logPath}`,
    log_path: logPath,
    executable_path: fly,
    executable_sha256: flySHA256,
  };
  const stableIdentity = (value: FlySSHAgentIdentity) => {
    const { state: _state, ...stable } = value;
    return stable;
  };
  const lock = (holders: readonly number[]) => ({
    path: lockPath,
    type: "file" as const,
    device: 16_777_232,
    inode: 68_449_375,
    mode: 0o600,
    uid: 501,
    gid: 20,
    nlink: 1,
    size: 0,
    holder_pids: holders,
  });
  const socket = (holders: readonly number[]) => ({
    path: socketPath,
    type: "socket" as const,
    device: 16_777_232,
    inode: 123_855_761,
    mode: 0o700,
    uid: 501,
    gid: 20,
    nlink: 1,
    size: 0,
    holder_pids: holders,
  });
  const activeObservation = (
    tracked: FlySSHAgentIdentity | null,
  ): FlySSHAgentObservation => ({
    schema: "agenttool-phase-b-refence-fly-ssh-agent-observation/v1",
    observed_at_unix_ms: startedAt + 1_000,
    agent_processes: [structuredClone(identity)],
    pinned_fly_process_count: 1,
    other_pinned_fly_process_count: 0,
    tracked_pid_absent: tracked === null ? null : false,
    tracked_pgid_absent: tracked === null ? null : false,
    socket: socket([identity.pid]),
    lock: lock([identity.pid]),
  });
  const absentObservation = (
    tracked: FlySSHAgentIdentity | null,
  ): FlySSHAgentObservation => ({
    schema: "agenttool-phase-b-refence-fly-ssh-agent-observation/v1",
    observed_at_unix_ms: startedAt + 2_000,
    agent_processes: [],
    pinned_fly_process_count: 0,
    other_pinned_fly_process_count: 0,
    tracked_pid_absent: tracked === null ? null : true,
    tracked_pgid_absent: tracked === null ? null : true,
    socket: null,
    lock: lock([]),
  });
  const protocolFrame = (body: string): Buffer => {
    const payload = Buffer.from(body, "ascii");
    const frame = Buffer.alloc(payload.byteLength + 2);
    frame.writeUInt16LE(payload.byteLength, 0);
    payload.copy(frame, 2);
    return frame;
  };
  const protocolEndpoint = async (
    onRequest: (request: string, socket: NetSocket, ordinal: number) => void,
  ) => {
    const directory = realpathSync(
      mkdtempSync("/tmp/agenttool-contained-fly-protocol-"),
    );
    temporaryDirectories.push(directory);
    const path = join(directory, "agent.sock");
    const requests: string[] = [];
    const sockets = new Set<NetSocket>();
    let connectionCount = 0;
    const server = createServer((connection) => {
      connectionCount += 1;
      sockets.add(connection);
      connection.on("error", () => {});
      connection.on("close", () => sockets.delete(connection));
      let buffer = Buffer.alloc(0);
      connection.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.byteLength >= 2) {
          const length = buffer.readUInt16LE(0);
          if (buffer.byteLength < length + 2) return;
          const request = buffer.subarray(2, length + 2).toString("ascii");
          buffer = buffer.subarray(length + 2);
          requests.push(request);
          onRequest(request, connection, requests.length);
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(path, () => {
        server.off("error", reject);
        resolve();
      });
    });
    const waitForClosed = async () => {
      for (let attempt = 0; attempt < 100 && sockets.size > 0; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2));
      }
      expect(sockets.size).toBe(0);
    };
    const close = async () => {
      for (const connection of sockets) connection.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => error ? reject(error) : resolve())
      );
    };
    return {
      path,
      requests,
      connectionCount: () => connectionCount,
      activeConnections: () => sockets.size,
      waitForClosed,
      close,
    };
  };

  type HarnessOptions = {
    batchID?: string;
    batchKind?: "cordoned_runtime" | "final_authority";
    probeFailureOrdinal?: number;
    recordIntentFailure?: boolean;
    sendMode?:
      | "ok"
      | "spawn"
      | "nonzero"
      | "timeout"
      | "output"
      | "two_sends"
      | "wrong_batch"
      | "wrong_argv"
      | "wrong_settlement";
    holdAgentAfterStop?: boolean;
    mutateObservation?: (
      checkpoint: string,
      occurrence: number,
      observation: FlySSHAgentObservation,
    ) => FlySSHAgentObservation;
  };
  const harness = (options: HarnessOptions = {}) => {
    const batchKind = options.batchKind ?? "cordoned_runtime";
    const expectedProbeCount = batchKind === "cordoned_runtime" ? 4 : 8;
    const batchID = options.batchID ?? `${batchKind}_${"a".repeat(24)}`;
    const events: string[] = [];
    const checkpointOccurrences = new Map<string, number>();
    let created = false;
    let stopped = false;
    let stopIntentCount = 0;
    let stopSendCount = 0;
    let cleanupCount = 0;
    const promise = runFlySSHAgentOwnedBatchForTest({
      batchID,
      batchKind,
      expectedProbeCount,
      nowUnixMilliseconds: () => startedAt,
      observe: async (tracked, checkpoint) => {
        events.push(`observe:${checkpoint}`);
        const occurrence = (checkpointOccurrences.get(checkpoint) ?? 0) + 1;
        checkpointOccurrences.set(checkpoint, occurrence);
        const raw = created && (!stopped || options.holdAgentAfterStop)
          ? activeObservation(tracked)
          : absentObservation(tracked);
        return options.mutateObservation?.(
          checkpoint,
          occurrence,
          structuredClone(raw),
        ) ?? raw;
      },
      connectStopProtocol: async () => {
        events.push("protocol:connect");
        return { closed: false };
      },
      pingStopProtocol: async (_protocol, receivedIdentity, identitySHA256, connectedReboundSHA256) => {
        events.push("protocol:ping");
        const response = `ok {"pid":${receivedIdentity.pid},"version":"0.4.74","disabled":false}`;
        return {
          schema: "agenttool-phase-b-refence-fly-ssh-agent-protocol-ping/v1",
          transport: "local_unix_stream",
          socket_path: socketPath,
          connected_without_write: true,
          connected_rebound_sha256: connectedReboundSHA256,
          connected_rebound_wal_sha256: sha256("connected-wal"),
          identity_sha256: identitySHA256,
          ping_frame_sha256:
            "705631fc8ed0643d62cba3fd15eb48d1b4c4e6ec9c7ec5801b7487baecac1cf0",
          response_pid: receivedIdentity.pid,
          response_version: "0.4.74",
          response_disabled: false,
          response_byte_count: response.length,
          response_sha256: sha256(response),
          child_spawn_count: 0,
        };
      },
      recordStopIntent: async (receivedBatchID, receivedIdentity, identitySHA256, ping, connectedReboundSHA256) => {
        events.push("stop:intent");
        stopIntentCount += 1;
        if (options.recordIntentFailure) throw new Error("intent uncertain");
        const protocolAuthoritySHA256 = sha256(canonicalJson({
          schema: "agenttool-phase-b-refence-fly-ssh-agent-protocol-authority/v1",
          transport: "local_unix_stream",
          socket_path: socketPath,
          connected_without_write: true,
          connected_rebound_sha256: connectedReboundSHA256,
          connected_rebound_wal_sha256: ping.connected_rebound_wal_sha256,
          identity_sha256: identitySHA256,
          ping_frame_sha256: ping.ping_frame_sha256,
          kill_frame_sha256:
            "47d190cebc34dd4b455ab19f9fe49c4fd342228b94651f6006b5c19e2b0e38be",
          ping_response_sha256: ping.response_sha256,
          ping_response_pid: ping.response_pid,
          ping_response_version: ping.response_version,
          ping_response_disabled: ping.response_disabled,
          child_spawn_count: 0,
        }));
        return {
          schema: "agenttool-phase-b-refence-fly-ssh-agent-stop-intent/v2",
          batch_id: receivedBatchID,
          identity_sha256: identitySHA256,
          cli_semantic_argv_sha256: sha256(canonicalJson([fly, "agent", "stop"])),
          cli_semantic_executed: false,
          protocol_authority_sha256: protocolAuthoritySHA256,
          ping_response_sha256: ping.response_sha256,
          durable_intent_sha256: sha256(`intent:${protocolAuthoritySHA256}`),
        };
      },
      sendStop: async (_protocol, intent, receivedIdentity, ping) => {
        events.push("stop:send");
        stopSendCount += 1;
        if (["spawn", "nonzero", "timeout"].includes(options.sendMode ?? "")) {
          throw new Error(`stop ${options.sendMode}`);
        }
        stopped = true;
        const protocolOperationSHA256 = sha256(canonicalJson({
          schema: "agenttool-phase-b-refence-fly-ssh-agent-protocol-operation/v1",
          transport: "local_unix_stream",
          socket_path: socketPath,
          protocol_authority_sha256: intent.protocol_authority_sha256,
          durable_intent_sha256: intent.durable_intent_sha256,
          cli_semantic_argv_sha256: intent.cli_semantic_argv_sha256,
          cli_semantic_executed: false,
          ping_frame_sha256: ping.ping_frame_sha256,
          kill_frame_sha256:
            "47d190cebc34dd4b455ab19f9fe49c4fd342228b94651f6006b5c19e2b0e38be",
          child_spawn_count: 0,
          stop_send_count: 1,
          retry_authorized: false,
        }));
        const settlementSHA256 = sha256(canonicalJson({
          schema:
            "agenttool-phase-b-refence-fly-ssh-agent-protocol-settlement/v1",
          transport: "local_unix_stream",
          socket_path: socketPath,
          protocol_operation_sha256: protocolOperationSHA256,
          kill_frame_sha256:
            "47d190cebc34dd4b455ab19f9fe49c4fd342228b94651f6006b5c19e2b0e38be",
          kill_response_sha256:
            "bf2a63ad5d209b2be8586a0f249aac31e432115a64d4fb93433d702564be2469",
          protocol_acknowledged: true,
          child_spawn_count: 0,
          stop_send_count: 1,
        }));
        const receipt = {
          schema: "agenttool-phase-b-refence-fly-ssh-agent-stop/v2",
          batch_id: intent.batch_id,
          identity_sha256: sha256(canonicalJson(stableIdentity(receivedIdentity))),
          cli_semantic_argv_sha256: sha256(canonicalJson([fly, "agent", "stop"])),
          cli_semantic_executed: false,
          protocol_authority_sha256: intent.protocol_authority_sha256,
          protocol_operation_sha256: protocolOperationSHA256,
          durable_intent_sha256: intent.durable_intent_sha256,
          settlement_sha256: settlementSHA256,
          transport: "local_unix_stream",
          socket_path: socketPath,
          ping_frame_sha256: ping.ping_frame_sha256,
          kill_frame_sha256:
            "47d190cebc34dd4b455ab19f9fe49c4fd342228b94651f6006b5c19e2b0e38be",
          ping_response_sha256: ping.response_sha256,
          kill_response_byte_count: 3,
          kill_response_sha256:
            "bf2a63ad5d209b2be8586a0f249aac31e432115a64d4fb93433d702564be2469",
          protocol_acknowledged: true,
          child_spawn_count: 0,
          stop_send_count: 1,
        };
        if (options.sendMode === "output") receipt.kill_response_byte_count = 4 as 3;
        if (options.sendMode === "two_sends") receipt.stop_send_count = 2;
        if (options.sendMode === "wrong_batch") receipt.batch_id = "wrong_batch";
        if (options.sendMode === "wrong_argv") receipt.cli_semantic_argv_sha256 = digest("f");
        if (options.sendMode === "wrong_settlement") receipt.settlement_sha256 = digest("e");
        return receipt as unknown as FlySSHAgentStopReceipt;
      },
      closeStopProtocol: async (protocol) => {
        events.push("protocol:close");
        (protocol as { closed: boolean }).closed = true;
      },
      pause: async (milliseconds) => {
        events.push(`pause:${milliseconds}`);
      },
      onCleanup: () => {
        events.push("cleanup:verified");
        cleanupCount += 1;
      },
      runBatch: async (launch) => {
        const values: number[] = [];
        for (let ordinal = 1; ordinal <= expectedProbeCount; ordinal += 1) {
          const argv = [
            fly,
            "ssh",
            "console",
            "--machine",
            ordinal.toString(16).padStart(14, "0"),
          ];
          values.push(await launch(argv, async (authority) => {
            events.push(`probe:${ordinal}`);
            consumeFlySSHAgentLaunchAuthorityForTest(authority, argv);
            created = true;
            if (options.probeFailureOrdinal === ordinal) {
              throw new Error(`probe_${ordinal}_failed`);
            }
            return ordinal;
          }));
        }
        return values;
      },
    });
    return {
      promise,
      events,
      counts: () => ({ cleanupCount, stopIntentCount, stopSendCount }),
    };
  };
  const requireManual = async (fixture: ReturnType<typeof harness>) => {
    let failure: unknown = null;
    try {
      await fixture.promise;
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(ControllerManualInterventionError);
    return failure as ControllerManualInterventionError;
  };

  test("parses exact rich ps and lowercase-unix lsof fixtures", () => {
    const ps = parseFlySSHAgentPSForTest(new TextEncoder().encode(
      `43768 1 43768 501 20 Wed Aug 26 09:47:25 2026 S ${fly} agent run ${logPath}\n`,
    ));
    expect(ps).toHaveLength(1);
    expect(ps[0]!.command).toBe(identity.command);
    const rawLSOF = [
      "p43768",
      "f12",
      "tREG",
      "D0x1000010",
      "i68449375",
      `n${lockPath}`,
      "f13",
      "tunix",
      `n${socketPath}`,
      "",
    ].join("\n");
    const lsof = parseFlySSHAgentLSOFForTest(new TextEncoder().encode(rawLSOF));
    expect(lsof).toEqual([
      {
        pid: 43768,
        descriptor: "12",
        type: "REG",
        name: lockPath,
        device: "0x1000010",
        inode: 68_449_375,
      },
      {
        pid: 43768,
        descriptor: "13",
        type: "unix",
        name: socketPath,
        device: null,
        inode: null,
      },
    ]);
    for (const corrupted of [
      rawLSOF.replace("tunix", "tUNIX"),
      rawLSOF.replace("tunix", "tIPv4"),
      rawLSOF.replace(`n${socketPath}`, `n${socketPath}\r`),
    ]) {
      expect(() => parseFlySSHAgentLSOFForTest(
        new TextEncoder().encode(corrupted),
      )).toThrow(MaintenanceRefenceError);
    }
  });

  test("raw process census counts alternate fly and flyctl executables", () => {
    const timestamp = "Wed Aug 26 09:47:25 2026";
    const raw = [
      `43768 1 43768 501 20 ${timestamp} S ${fly} agent run ${logPath}`,
      `43769 1 43769 501 20 ${timestamp} S /opt/homebrew/bin/flyctl machine list`,
      `43770 1 43770 501 20 ${timestamp} R /private/tmp/fly status`,
      `43771 1 43771 501 20 ${timestamp} S ${fly} status`,
      `43772 1 43772 501 20 ${timestamp} S /private/tmp/notflyctl status`,
      "",
    ].join("\n");
    expect(classifyFlySSHAgentPSForTest(new TextEncoder().encode(raw)))
      .toEqual({
        agent_process_pids: [43768],
        pinned_fly_process_count: 4,
        other_pinned_fly_process_count: 3,
      });
  });

  test("socket holder projection rejects lsof device or inode fields", () => {
    const raw = [
      "p43768",
      "f13",
      "tunix",
      `n${socketPath}`,
      "",
    ].join("\n");
    const metadata = {
      path: socketPath,
      type: "socket" as const,
      device: 16_777_232,
      inode: 123_855_761,
      mode: 0o700,
      uid: 501,
      gid: 20,
      nlink: 1,
      size: 0,
      holder_pids: [],
    };
    expect(flySSHAgentHolderPIDsForTest(
      new TextEncoder().encode(raw),
      metadata,
    )).toEqual([43768]);
    for (const injected of [
      raw.replace(`n${socketPath}`, `D0x1000010\nn${socketPath}`),
      raw.replace(`n${socketPath}`, `i123855761\nn${socketPath}`),
      raw.replace("tunix", "tREG"),
    ]) {
      expect(() => flySSHAgentHolderPIDsForTest(
        new TextEncoder().encode(injected),
        metadata,
      )).toThrow(MaintenanceRefenceError);
    }
  });

  test("final absence is exact, one-shot, and refuses an active observation", async () => {
    const lifecycle = new ProductionFlySSHAgentLifecycle(
      "maintenance-refence-aaaaaaaaaaaa-20260825T120000Z-0123456789abcdef",
    );
    const cleanupSHA256s: string[] = [];
    for (const batchKind of ["cordoned_runtime", "final_authority"] as const) {
      const batchID = lifecycle.begin(batchKind);
      const result = await harness({ batchID, batchKind }).promise;
      const cleanupSHA256 = sha256(canonicalJson(result.cleanup));
      lifecycle.recordCleanup(
        batchKind,
        cleanupSHA256,
        result.cleanup,
      );
      cleanupSHA256s.push(cleanupSHA256);
    }
    lifecycle.requireSuccessProofs(cleanupSHA256s[0], cleanupSHA256s[1]);
    let activeCalls = 0;
    await expect(lifecycle.proveFinalizationAbsence(async () => {
      activeCalls += 1;
      return activeObservation(null);
    })).rejects.toMatchObject({ code: "fly_agent_finalization" });
    expect(activeCalls).toBe(1);
    expect(lifecycle.finalAbsenceSHA256).toBeNull();

    const absence = absentObservation(null);
    const expected = sha256(canonicalJson({
      schema: absence.schema,
      agent_processes: [],
      pinned_fly_process_count: 0,
      other_pinned_fly_process_count: 0,
      tracked_pid_absent: null,
      tracked_pgid_absent: null,
      socket: null,
      lock: lock([]),
    }));
    expect(expected).not.toBe(sha256(canonicalJson(absence)));
    expect(await lifecycle.proveFinalizationAbsence(async () => absence))
      .toBe(expected);
    expect(lifecycle.finalAbsenceSHA256).toBe(expected);
    let repeatedCalls = 0;
    await expect(lifecycle.proveFinalizationAbsence(async () => {
      repeatedCalls += 1;
      return absence;
    })).rejects.toMatchObject({ code: "fly_agent_finalization" });
    expect(repeatedCalls).toBe(0);
    expect(lifecycle.finalAbsenceSHA256).toBe(expected);
  });

  test("direct Unix protocol binds one fragmented ping and kill on one closed connection", async () => {
    const pingBody =
      `ok {"pid":${identity.pid},"version":"0.4.74","disabled":false}`;
    const endpoint = await protocolEndpoint((request, connection) => {
      const frame = protocolFrame(request === "ping" ? pingBody : "ok ");
      connection.write(frame.subarray(0, 1));
      setTimeout(() => connection.write(frame.subarray(1, 3)), 2);
      setTimeout(() => connection.write(frame.subarray(3)), 4);
    });
    let protocol: Awaited<ReturnType<
      typeof connectFlySSHAgentProtocolForContainedTest
    >> | null = null;
    try {
      protocol = await connectFlySSHAgentProtocolForContainedTest({
        path: endpoint.path,
        timeoutMilliseconds: 200,
      });
      const identitySHA256 = sha256(canonicalJson(stableIdentity(identity)));
      const ping = await protocol.ping(
        identity,
        identitySHA256,
        sha256("connected-rebound"),
        sha256("connected-rebound-wal"),
      );
      expect(ping.response_pid).toBe(identity.pid);
      expect(ping.response_version).toBe("0.4.74");
      let authorityChecks = 0;
      await expect(protocol.kill(() => authorityChecks += 1)).resolves.toBe(
        "bf2a63ad5d209b2be8586a0f249aac31e432115a64d4fb93433d702564be2469",
      );
      expect(authorityChecks).toBe(1);
      expect(endpoint.requests).toEqual(["ping", "kill"]);
      expect(endpoint.connectionCount()).toBe(1);
    } finally {
      if (protocol !== null) await protocol.close().catch(() => {});
      await endpoint.waitForClosed();
      await endpoint.close();
    }
  });

  test("direct Unix protocol refuses hostile framing, preloads, uncertainty, and leaked connects", async () => {
    const pingBody =
      `ok {"pid":${identity.pid},"version":"0.4.74","disabled":false}`;
    const identitySHA256 = sha256(canonicalJson(stableIdentity(identity)));
    const pingArguments = [
      identity,
      identitySHA256,
      sha256("connected-rebound"),
      sha256("connected-rebound-wal"),
    ] as const;
    const pingFailures = [
      ["wrong_pid", (connection: NetSocket) =>
        connection.write(protocolFrame(pingBody.replace("43768", "43769")))],
      ["wrong_version", (connection: NetSocket) =>
        connection.write(protocolFrame(pingBody.replace("0.4.74", "0.4.75")))],
      ["trailing", (connection: NetSocket) =>
        connection.write(Buffer.concat([protocolFrame(pingBody), Buffer.of(0)]))],
      ["short_length", (connection: NetSocket) =>
        connection.write(Buffer.of(2, 0, 111, 107))],
      ["oversize", (connection: NetSocket) =>
        connection.write(Buffer.alloc(1_027, 97))],
      ["eof", (connection: NetSocket) => connection.end()],
      ["read_timeout", (_connection: NetSocket) => {}],
      ["partial_timeout", (connection: NetSocket) =>
        connection.write(Buffer.of(10, 0, 111))],
      ["socket_error", (connection: NetSocket) => connection.destroy()],
    ] as const;
    for (const [name, respond] of pingFailures) {
      const endpoint = await protocolEndpoint((_request, connection) =>
        respond(connection)
      );
      let protocol: Awaited<ReturnType<
        typeof connectFlySSHAgentProtocolForContainedTest
      >> | null = null;
      try {
        protocol = await connectFlySSHAgentProtocolForContainedTest({
          path: endpoint.path,
          timeoutMilliseconds: 60,
        });
        await expect(protocol.ping(...pingArguments), name).rejects.toBeDefined();
        expect(endpoint.requests, name).toEqual(["ping"]);
      } finally {
        if (protocol !== null) await protocol.close().catch(() => {});
        await endpoint.waitForClosed();
        await endpoint.close();
      }
    }

    const preloaded = await protocolEndpoint((request, connection) => {
      if (request === "ping") {
        connection.write(protocolFrame(pingBody));
        setTimeout(() => connection.write(protocolFrame("ok ")), 4);
      }
    });
    let preloadedProtocol: Awaited<ReturnType<
      typeof connectFlySSHAgentProtocolForContainedTest
    >> | null = null;
    try {
      preloadedProtocol = await connectFlySSHAgentProtocolForContainedTest({
        path: preloaded.path,
        timeoutMilliseconds: 100,
      });
      await preloadedProtocol.ping(...pingArguments);
      await new Promise((resolve) => setTimeout(resolve, 12));
      let authorityChecks = 0;
      await expect(preloadedProtocol.kill(() => authorityChecks += 1)).rejects
        .toBeInstanceOf(MaintenanceRefenceError);
      expect(authorityChecks).toBe(1);
      expect(preloaded.requests).toEqual(["ping"]);
    } finally {
      if (preloadedProtocol !== null) {
        await preloadedProtocol.close().catch(() => {});
      }
      await preloaded.waitForClosed();
      await preloaded.close();
    }

    for (const mode of ["wrong_ack", "eof", "timeout"] as const) {
      const endpoint = await protocolEndpoint((request, connection) => {
        if (request === "ping") connection.write(protocolFrame(pingBody));
        else if (mode === "wrong_ack") connection.write(protocolFrame("no "));
        else if (mode === "eof") connection.end();
      });
      let protocol: Awaited<ReturnType<
        typeof connectFlySSHAgentProtocolForContainedTest
      >> | null = null;
      try {
        protocol = await connectFlySSHAgentProtocolForContainedTest({
          path: endpoint.path,
          timeoutMilliseconds: 60,
        });
        await protocol.ping(...pingArguments);
        let authorityChecks = 0;
        await expect(protocol.kill(() => authorityChecks += 1), mode).rejects
          .toBeDefined();
        expect(authorityChecks, mode).toBe(1);
        expect(endpoint.requests, mode).toEqual(["ping", "kill"]);
      } finally {
        if (protocol !== null) await protocol.close().catch(() => {});
        await endpoint.waitForClosed();
        await endpoint.close();
      }
    }

    const writeTimeout = await protocolEndpoint(() => {});
    let writeTimeoutProtocol: Awaited<ReturnType<
      typeof connectFlySSHAgentProtocolForContainedTest
    >> | null = null;
    try {
      writeTimeoutProtocol = await connectFlySSHAgentProtocolForContainedTest({
        path: writeTimeout.path,
        timeoutMilliseconds: 40,
        suppressWriteCallback: true,
      });
      await expect(writeTimeoutProtocol.ping(...pingArguments)).rejects
        .toBeDefined();
      expect(writeTimeout.requests).toEqual(["ping"]);
    } finally {
      if (writeTimeoutProtocol !== null) {
        await writeTimeoutProtocol.close().catch(() => {});
      }
      await writeTimeout.waitForClosed();
      await writeTimeout.close();
    }

    const postcondition = await protocolEndpoint(() => {});
    try {
      await expect(connectFlySSHAgentProtocolForContainedTest({
        path: postcondition.path,
        timeoutMilliseconds: 60,
        forcePostconditionFailure: true,
      })).rejects.toBeInstanceOf(MaintenanceRefenceError);
      await postcondition.waitForClosed();
      expect(postcondition.connectionCount()).toBe(1);
      expect(postcondition.activeConnections()).toBe(0);
    } finally {
      await postcondition.close();
    }
  });

  test("owns exactly four and eight SSH probes with one intent, stop, and two absences", async () => {
    for (const batchKind of ["cordoned_runtime", "final_authority"] as const) {
      const fixture = harness({ batchKind });
      const result = await fixture.promise;
      const count = batchKind === "cordoned_runtime" ? 4 : 8;
      expect(result.result).toEqual(
        Array.from({ length: count }, (_, index) => index + 1),
      );
      expect(result.cleanup.expected_probe_count).toBe(count);
      expect(result.cleanup.completed_probe_count).toBe(count);
      expect(result.cleanup.stop_send_count).toBe(1);
      expect(result.cleanup.absence_interval_milliseconds).toBe(257);
      expect(fixture.counts()).toEqual({
        cleanupCount: 1,
        stopIntentCount: 1,
        stopSendCount: 1,
      });
      expect(fixture.events.filter((entry) => entry.startsWith("probe:")))
        .toHaveLength(count);
      expect(fixture.events.indexOf("stop:intent")).toBeLessThan(
        fixture.events.indexOf(
          `observe:${batchKind}_cleanup_intent_rebound`,
        ),
      );
      expect(fixture.events.indexOf(
        `observe:${batchKind}_cleanup_intent_rebound`,
      )).toBeLessThan(fixture.events.indexOf("stop:send"));
      expect(fixture.events.at(-3)).toBe("pause:257");
      expect(fixture.events.at(-2)).toBe(
        `observe:${batchKind}_cleanup_absence_rebound`,
      );
      expect(fixture.events.at(-1)).toBe("cleanup:verified");
    }
  });

  test("accepts non-zombie ps state movement while retaining stable identity", async () => {
    const fixture = harness({
      mutateObservation: (checkpoint, _occurrence, value) => {
        if (checkpoint === "cordoned_runtime_probe_2_agent") {
          (value.agent_processes[0] as FlySSHAgentIdentity).state = "R+";
        }
        return value;
      },
    });
    const result = await fixture.promise;
    expect(result.cleanup.verified).toBeTrue();
    expect(fixture.counts().stopSendCount).toBe(1);
  });

  test("refuses duplicate, alternate, wrong identity/path, and socket-mode observations", async () => {
    const cases: Array<[
      string,
      (value: FlySSHAgentObservation) => void,
      number,
    ]> = [
      ["duplicate_agent", (value) => {
        value.agent_processes = [
          ...value.agent_processes,
          structuredClone(identity),
        ];
        value.pinned_fly_process_count = 2;
      }, 1],
      ["alternate_fly", (value) => {
        value.pinned_fly_process_count = 2;
        value.other_pinned_fly_process_count = 1;
      }, 1],
      ["ppid", (value) => {
        (value.agent_processes[0] as FlySSHAgentIdentity).ppid = 2 as 1;
      }, 1],
      ["pgid", (value) => {
        (value.agent_processes[0] as FlySSHAgentIdentity).pgid += 1;
      }, 1],
      ["uid", (value) => {
        (value.agent_processes[0] as FlySSHAgentIdentity).uid = 502 as 501;
      }, 1],
      ["gid", (value) => {
        (value.agent_processes[0] as FlySSHAgentIdentity).gid = 21 as 20;
      }, 1],
      ["start", (value) => {
        (value.agent_processes[0] as FlySSHAgentIdentity)
          .started_at_unix_ms -= 60_000;
      }, 1],
      ["state", (value) => {
        (value.agent_processes[0] as FlySSHAgentIdentity).state = "Z";
      }, 1],
      ["tilde_log", (value) => {
        const row = value.agent_processes[0] as FlySSHAgentIdentity;
        row.command = `${fly} agent run ~/.fly/agent-logs/20456402.log`;
        row.log_path = "~/.fly/agent-logs/20456402.log";
      }, 1],
      ["wrong_home", (value) => {
        const row = value.agent_processes[0] as FlySSHAgentIdentity;
        row.command = `${fly} agent run /tmp/.fly/agent-logs/20456402.log`;
        row.log_path = "/tmp/.fly/agent-logs/20456402.log";
      }, 1],
      ["extra_args", (value) => {
        (value.agent_processes[0] as FlySSHAgentIdentity).command += " extra";
      }, 1],
      ["executable_path", (value) => {
        (value.agent_processes[0] as FlySSHAgentIdentity).executable_path =
          "/tmp/fly" as typeof fly;
      }, 1],
      ["executable_hash", (value) => {
        (value.agent_processes[0] as FlySSHAgentIdentity)
          .executable_sha256 = digest("f") as typeof flySHA256;
      }, 1],
      ["socket_missing", (value) => {
        value.socket = null;
      }, 1],
      ["lock_missing", (value) => {
        value.lock = null;
      }, 1],
      ["socket_0755", (value) => {
        value.socket!.mode = 0o755;
      }, 1],
      ["socket_holder", (value) => {
        value.socket!.holder_pids = [];
      }, 1],
      ["lock_holder", (value) => {
        value.lock!.holder_pids = [];
      }, 1],
      ["socket_drift", (value) => {
        value.socket!.inode += 1;
      }, 2],
      ["lock_drift", (value) => {
        value.lock!.inode += 1;
      }, 2],
      ["same_command_restart", (value) => {
        const row = value.agent_processes[0] as FlySSHAgentIdentity;
        row.pid += 1;
        row.pgid = row.pid;
        value.socket!.holder_pids = [row.pid];
        value.lock!.holder_pids = [row.pid];
      }, 2],
    ];
    for (const [label, mutate, probe] of cases) {
      const fixture = harness({
        mutateObservation: (checkpoint, _occurrence, value) => {
          if (checkpoint === `cordoned_runtime_probe_${probe}_agent`) {
            mutate(value);
          }
          return value;
        },
      });
      const failure = await requireManual(fixture);
      expect(failure.code.length, label).toBeGreaterThan(0);
      expect(fixture.counts().stopSendCount, label).toBeLessThanOrEqual(1);
    }
  });

  test("refuses dirty admission before any SSH or stop", async () => {
    const admissions: Array<(value: FlySSHAgentObservation) => void> = [
      (value) => {
        value.agent_processes = [structuredClone(identity)];
        value.pinned_fly_process_count = 1;
        value.socket = socket([identity.pid]);
        value.lock = lock([identity.pid]);
      },
      (value) => {
        value.pinned_fly_process_count = 1;
        value.other_pinned_fly_process_count = 1;
      },
      (value) => {
        value.socket = socket([]);
      },
      (value) => {
        value.lock = lock([identity.pid]);
      },
    ];
    for (const mutate of admissions) {
      const fixture = harness({
        mutateObservation: (checkpoint, _occurrence, value) => {
          if (checkpoint === "cordoned_runtime_agent_admission") mutate(value);
          return value;
        },
      });
      await requireManual(fixture);
      expect(fixture.events.some((entry) => entry.startsWith("probe:")))
        .toBeFalse();
      expect(fixture.counts()).toEqual({
        cleanupCount: 0,
        stopIntentCount: 0,
        stopSendCount: 0,
      });
    }
  });

  test("cleans before propagating first, middle, and last SSH failures", async () => {
    for (const ordinal of [1, 2, 4]) {
      const fixture = harness({ probeFailureOrdinal: ordinal });
      let failure: unknown = null;
      try {
        await fixture.promise;
      } catch (error) {
        failure = error;
      }
      expect((failure as Error).message).toBe(`probe_${ordinal}_failed`);
      expect(failure).not.toBeInstanceOf(ControllerManualInterventionError);
      expect(fixture.counts()).toEqual({
        cleanupCount: 1,
        stopIntentCount: 1,
        stopSendCount: 1,
      });
      expect(fixture.events.at(-1)).toBe("cleanup:verified");
    }
  });

  test("post-intent death, replacement, and path drift retain manual without a stop send", async () => {
    const mutations: Array<(value: FlySSHAgentObservation) => void> = [
      (value) => {
        Object.assign(value, absentObservation(identity));
      },
      (value) => {
        const row = value.agent_processes[0] as FlySSHAgentIdentity;
        row.pid += 1;
        row.pgid = row.pid;
        value.socket!.holder_pids = [row.pid];
        value.lock!.holder_pids = [row.pid];
      },
      (value) => {
        value.socket!.inode += 1;
      },
      (value) => {
        value.lock!.holder_pids = [];
      },
    ];
    for (const mutate of mutations) {
      const fixture = harness({
        mutateObservation: (checkpoint, _occurrence, value) => {
          if (checkpoint === "cordoned_runtime_cleanup_intent_rebound") {
            mutate(value);
          }
          return value;
        },
      });
      await requireManual(fixture);
      expect(fixture.counts()).toEqual({
        cleanupCount: 0,
        stopIntentCount: 1,
        stopSendCount: 0,
      });
    }
  });

  test("stop uncertainty and bounded absence uncertainty never retry or succeed", async () => {
    for (const sendMode of [
      "spawn",
      "nonzero",
      "timeout",
      "output",
      "two_sends",
      "wrong_batch",
      "wrong_argv",
      "wrong_settlement",
    ] as const) {
      const fixture = harness({ sendMode });
      await requireManual(fixture);
      expect(fixture.counts().stopSendCount, sendMode).toBe(1);
      expect(fixture.counts().cleanupCount, sendMode).toBe(0);
    }
    const intent = harness({ recordIntentFailure: true });
    await requireManual(intent);
    expect(intent.counts()).toEqual({
      cleanupCount: 0,
      stopIntentCount: 1,
      stopSendCount: 0,
    });
    const timeout = harness({ holdAgentAfterStop: true });
    await requireManual(timeout);
    expect(timeout.counts().stopSendCount).toBe(1);
    expect(timeout.events.filter((entry) => entry === "pause:250"))
      .toHaveLength(20);
    const rebound = harness({
      mutateObservation: (checkpoint, _occurrence, value) => {
        if (checkpoint === "cordoned_runtime_cleanup_absence_rebound") {
          value.socket = socket([]);
        }
        return value;
      },
    });
    await requireManual(rebound);
    expect(rebound.counts()).toEqual({
      cleanupCount: 0,
      stopIntentCount: 1,
      stopSendCount: 1,
    });
  });

  test("WAL replays two ordered four-read groups and one exact no-child stop", async () => {
    const directory = realpathSync(
      mkdtempSync(join(tmpdir(), "refence-agent-lifecycle-wal-")),
    );
    temporaryDirectories.push(directory);
    chownSync(directory, process.getuid!(), process.getgid!());
    chmodSync(directory, 0o700);
    const expected = {
      controllerRunID: "01234567-89ab-cdef-0123-456789abcdef",
      rolloutID:
        "maintenance-refence-aaaaaaaaaaaa-20260825T120000Z-0123456789abcdef",
      receiptSHA256: digest("a"),
    };
    const wal = new ControllerWalWriter({ directory, ...expected });
    wal.append({
      recorded_at: "2026-08-26T09:47:20Z",
      phase: "ready",
      checkpoint: "controller_ready",
      effect_id: null,
      effect_kind: null,
      target: null,
      argv_sha256: null,
      pid: null,
      pgid: null,
      exit_code: null,
      termination: null,
      local_process_group_settled: true,
      provider_transition_sha256: null,
      fleet_readback_sha256: null,
      detail_sha256: digest("b"),
      failure_code: null,
    });
    let nextPID = 50_000;
    const runtime = {
      now: () => "2026-08-26T09:47:21Z",
      spawn: () => {
        nextPID += 1;
        return { pid: nextPID, pgid: nextPID };
      },
      settle: async () => ({
        exitCode: 0,
        termination: "exit" as const,
        processGroupSettled: true,
        detailSHA256: sha256(`settled:${nextPID}`),
      }),
      takeStdout: () => new Uint8Array(),
      takeStderr: () => new Uint8Array(),
    };
    const read = async (
      effectID: string,
      checkpoint: string,
      target = "local_fly_ssh_agent",
      argv: readonly string[] = ["/bin/ps", "-p", "1"],
    ) => performControllerJournalledReadChildForTest({
      wal,
      runtime,
      effectID,
      effectKind: "read_process",
      checkpoint,
      target,
      argv,
      timeoutMilliseconds: 30_000,
      acceptedExitCodes: [0],
      validate: () => ({ value: true, semanticProjection: { ok: true } }),
      validateStderr: (stderr) => expect(stderr.byteLength).toBe(0),
    });
    await read("initial_process", "controller_initial_process", "local_processes");
    const stopArgv = [fly, "agent", "stop"] as const;
    const batchID = `cordoned_runtime_${"a".repeat(24)}`;
    const observationArgvs = [
      [
        "/bin/ps", "-axo", "pid=", "-o", "ppid=", "-o", "pgid=", "-o",
        "uid=", "-o", "gid=", "-o", "lstart=", "-o", "state=", "-o",
        "command=",
      ],
      [
        "/usr/sbin/lsof", "-nP", "-F", "pftnDi", "--", lockPath, socketPath,
      ],
      [
        "/bin/ps", "-p", "43768", "-ww", "-o", "pid=", "-o", "ppid=",
        "-o", "pgid=", "-o", "uid=", "-o", "gid=", "-o", "lstart=", "-o",
        "state=", "-o", "command=",
      ],
      [
        "/usr/sbin/lsof", "-nP", "-a", "-p", "43768", "-d", "txt", "-F",
        "pftnDi",
      ],
    ] as const;
    const appendObservation = async (
      firstEffectOrdinal: number,
      checkpoint: string,
    ) => {
      const suffixes = [
        "process_census",
        "path_holders",
        "identity_43768",
        "text_43768",
      ];
      for (let index = 0; index < suffixes.length; index += 1) {
        await read(
          `agent_${String(firstEffectOrdinal + index).padStart(6, "0")}_${suffixes[index]}`,
          checkpoint,
          "local_fly_ssh_agent",
          observationArgvs[index],
        );
      }
    };
    await appendObservation(2, "cordoned_runtime_cleanup_connected_rebound");
    const intent = wal.append({
      recorded_at: "2026-08-26T09:47:22Z",
      phase: "lifecycle_intent",
      checkpoint: "fly_agent_cleanup_stop_intent_direct_unix_protocol",
      effect_id: "agent_000006_stop_intent",
      effect_kind: "local_agent_stop",
      target: batchID,
      argv_sha256: sha256(canonicalJson(stopArgv)),
      pid: null,
      pgid: null,
      exit_code: null,
      termination: null,
      local_process_group_settled: true,
      provider_transition_sha256: null,
      fleet_readback_sha256: null,
      detail_sha256: sha256("protocol-authority"),
      failure_code: null,
    });
    const intentSHA256 = sha256(`${canonicalJson(intent)}\n`);
    await appendObservation(7, "cordoned_runtime_cleanup_intent_rebound");
    const protocolOperationSHA256 = sha256(canonicalJson({
      schema: "agenttool-phase-b-refence-fly-ssh-agent-protocol-operation/v1",
      transport: "local_unix_stream",
      socket_path: socketPath,
      protocol_authority_sha256: intent.detail_sha256,
      durable_intent_sha256: intentSHA256,
      cli_semantic_argv_sha256: intent.argv_sha256,
      cli_semantic_executed: false,
      ping_frame_sha256:
        "705631fc8ed0643d62cba3fd15eb48d1b4c4e6ec9c7ec5801b7487baecac1cf0",
      kill_frame_sha256:
        "47d190cebc34dd4b455ab19f9fe49c4fd342228b94651f6006b5c19e2b0e38be",
      child_spawn_count: 0,
      stop_send_count: 1,
      retry_authorized: false,
    }));
    const stopBase = {
      checkpoint:
        "fly_agent_cleanup_stop_direct_unix_protocol_child_spawn_count_0",
      effect_id: "agent_000006_stop",
      effect_kind: "local_agent_stop" as const,
      target: batchID,
      argv_sha256: protocolOperationSHA256,
    };
    const directSettlementSHA256 = (operationSHA256: string) =>
      sha256(canonicalJson({
        schema:
          "agenttool-phase-b-refence-fly-ssh-agent-protocol-settlement/v1",
        transport: "local_unix_stream",
        socket_path: socketPath,
        protocol_operation_sha256: operationSHA256,
        kill_frame_sha256:
          "47d190cebc34dd4b455ab19f9fe49c4fd342228b94651f6006b5c19e2b0e38be",
        kill_response_sha256:
          "bf2a63ad5d209b2be8586a0f249aac31e432115a64d4fb93433d702564be2469",
        protocol_acknowledged: true,
        child_spawn_count: 0,
        stop_send_count: 1,
      }));
    const directVerificationSHA256 = (request: {
      batchID: string;
      protocolAuthoritySHA256: string;
      durableIntentSHA256: string;
      protocolOperationSHA256: string;
      settlementSHA256: string;
    }) => sha256(canonicalJson({
      schema:
        "agenttool-phase-b-refence-fly-ssh-agent-stop-wal-verification/v1",
      transport: "local_unix_stream",
      socket_path: socketPath,
      batch_id: request.batchID,
      protocol_authority_sha256: request.protocolAuthoritySHA256,
      durable_intent_sha256: request.durableIntentSHA256,
      protocol_operation_sha256: request.protocolOperationSHA256,
      settlement_sha256: request.settlementSHA256,
      kill_frame_sha256:
        "47d190cebc34dd4b455ab19f9fe49c4fd342228b94651f6006b5c19e2b0e38be",
      kill_response_sha256:
        "bf2a63ad5d209b2be8586a0f249aac31e432115a64d4fb93433d702564be2469",
      protocol_acknowledged: true,
      child_spawn_count: 0,
      stop_send_count: 1,
    }));
    const settlementSHA256 = directSettlementSHA256(protocolOperationSHA256);
    const walVerificationSHA256 = directVerificationSHA256({
      batchID,
      protocolAuthoritySHA256: intent.detail_sha256!,
      durableIntentSHA256: intentSHA256,
      protocolOperationSHA256,
      settlementSHA256,
    });
    wal.append({
      ...stopBase,
      recorded_at: "2026-08-26T09:47:23Z",
      phase: "attempting",
      pid: null,
      pgid: null,
      exit_code: null,
      termination: null,
      local_process_group_settled: true,
      provider_transition_sha256: null,
      fleet_readback_sha256: null,
      detail_sha256: intentSHA256,
      failure_code: null,
    });
    wal.append({
      ...stopBase,
      recorded_at: "2026-08-26T09:47:24Z",
      phase: "settled",
      pid: null,
      pgid: null,
      exit_code: null,
      termination: null,
      local_process_group_settled: true,
      provider_transition_sha256: null,
      fleet_readback_sha256: null,
      detail_sha256: settlementSHA256,
      failure_code: null,
    });
    const firstStopVerified = wal.append({
      ...stopBase,
      recorded_at: "2026-08-26T09:47:25Z",
      phase: "verified",
      pid: null,
      pgid: null,
      exit_code: null,
      termination: null,
      local_process_group_settled: true,
      provider_transition_sha256: null,
      fleet_readback_sha256: null,
      detail_sha256: walVerificationSHA256,
      failure_code: null,
    });
    await appendObservation(11, "final_authority_cleanup_connected_rebound");
    const secondBatchID = `final_authority_${"b".repeat(24)}`;
    const secondIntent = wal.append({
      recorded_at: "2026-08-26T09:47:26Z",
      phase: "lifecycle_intent",
      checkpoint: "fly_agent_cleanup_stop_intent_direct_unix_protocol",
      effect_id: "agent_000015_stop_intent",
      effect_kind: "local_agent_stop",
      target: secondBatchID,
      argv_sha256: sha256(canonicalJson(stopArgv)),
      pid: null,
      pgid: null,
      exit_code: null,
      termination: null,
      local_process_group_settled: true,
      provider_transition_sha256: null,
      fleet_readback_sha256: null,
      detail_sha256: sha256("second-protocol-authority"),
      failure_code: null,
    });
    const secondIntentSHA256 = sha256(`${canonicalJson(secondIntent)}\n`);
    await appendObservation(16, "final_authority_cleanup_intent_rebound");
    const secondProtocolOperationSHA256 = sha256(canonicalJson({
      schema: "agenttool-phase-b-refence-fly-ssh-agent-protocol-operation/v1",
      transport: "local_unix_stream",
      socket_path: socketPath,
      protocol_authority_sha256: secondIntent.detail_sha256,
      durable_intent_sha256: secondIntentSHA256,
      cli_semantic_argv_sha256: secondIntent.argv_sha256,
      cli_semantic_executed: false,
      ping_frame_sha256:
        "705631fc8ed0643d62cba3fd15eb48d1b4c4e6ec9c7ec5801b7487baecac1cf0",
      kill_frame_sha256:
        "47d190cebc34dd4b455ab19f9fe49c4fd342228b94651f6006b5c19e2b0e38be",
      child_spawn_count: 0,
      stop_send_count: 1,
      retry_authorized: false,
    }));
    const secondSettlementSHA256 = directSettlementSHA256(
      secondProtocolOperationSHA256,
    );
    const secondVerificationSHA256 = directVerificationSHA256({
      batchID: secondBatchID,
      protocolAuthoritySHA256: secondIntent.detail_sha256!,
      durableIntentSHA256: secondIntentSHA256,
      protocolOperationSHA256: secondProtocolOperationSHA256,
      settlementSHA256: secondSettlementSHA256,
    });
    const secondStopBase = {
      checkpoint:
        "fly_agent_cleanup_stop_direct_unix_protocol_child_spawn_count_0",
      effect_id: "agent_000015_stop",
      effect_kind: "local_agent_stop" as const,
      target: secondBatchID,
      argv_sha256: secondProtocolOperationSHA256,
    };
    wal.append({
      ...secondStopBase,
      recorded_at: "2026-08-26T09:47:27Z",
      phase: "attempting",
      pid: null,
      pgid: null,
      exit_code: null,
      termination: null,
      local_process_group_settled: true,
      provider_transition_sha256: null,
      fleet_readback_sha256: null,
      detail_sha256: secondIntentSHA256,
      failure_code: null,
    });
    wal.append({
      ...secondStopBase,
      recorded_at: "2026-08-26T09:47:28Z",
      phase: "settled",
      pid: null,
      pgid: null,
      exit_code: null,
      termination: null,
      local_process_group_settled: true,
      provider_transition_sha256: null,
      fleet_readback_sha256: null,
      detail_sha256: secondSettlementSHA256,
      failure_code: null,
    });
    const secondStopVerified = wal.append({
      ...secondStopBase,
      recorded_at: "2026-08-26T09:47:29Z",
      phase: "verified",
      pid: null,
      pgid: null,
      exit_code: null,
      termination: null,
      local_process_group_settled: true,
      provider_transition_sha256: null,
      fleet_readback_sha256: null,
      detail_sha256: secondVerificationSHA256,
      failure_code: null,
    });
    wal.append({
      recorded_at: "2026-08-26T09:47:30Z",
      phase: "complete",
      checkpoint: "controller_complete",
      effect_id: null,
      effect_kind: null,
      target: null,
      argv_sha256: null,
      pid: null,
      pgid: null,
      exit_code: null,
      termination: null,
      local_process_group_settled: true,
      provider_transition_sha256: null,
      fleet_readback_sha256: null,
      detail_sha256: sha256("complete"),
      failure_code: null,
    });
    expect(wal.replayProjection()).toEqual(wal.projection());
    expect(wal.replayProjection()).toEqual(wal.projection());
    const records = Array.from(
      { length: wal.lastEntry!.ordinal },
      (_, index) => wal.entryAt(index + 1)!,
    );
    const stopAttempt = records.find((entry) =>
      entry.effect_id === "agent_000006_stop" && entry.phase === "attempting"
    )!;
    expect(stopAttempt.detail_sha256).toBe(intentSHA256);
    const contract = createMaintenanceContract({
      canonical: canonicalJson,
      digest: sha256,
      refuse: (code: string): never => {
        throw new MaintenanceRefenceError(code);
      },
    });
    const rehash = (candidates: any[]) => {
      for (let index = 0; index < candidates.length; index += 1) {
        candidates[index].ordinal = index + 1;
        candidates[index].prior_entry_sha256 = index === 0
          ? null
          : sha256(`${canonicalJson(candidates[index - 1])}\n`);
      }
    };
    const validateRecords = (candidates: any[]) => {
      const accepted: any[] = [];
      for (const candidate of candidates) {
        contract.validateControllerWalEntry(
          candidate,
          accepted.at(-1) ?? null,
          accepted,
          expected,
        );
        accepted.push(candidate);
      }
    };
    const replay = (mutate: (records: any[]) => void) => {
      const candidates = structuredClone(records) as any[];
      mutate(candidates);
      rehash(candidates);
      validateRecords(candidates);
    };
    expect(() => replay(() => {})).not.toThrow();
    expect(() => replay((candidates) => {
      const entry = candidates.find((candidate) =>
        candidate.effect_id === "agent_000006_stop" &&
        candidate.phase === "attempting"
      );
      entry.detail_sha256 = digest("f");
    })).toThrow(MaintenanceRefenceError);
    expect(() => replay((candidates) => {
      const entry = candidates.find((candidate) =>
        candidate.phase === "lifecycle_intent"
      );
      entry.target = `final_authority_${"b".repeat(24)}`;
    })).toThrow(MaintenanceRefenceError);
    expect(() => replay((candidates) => {
      const entry = candidates.find((candidate) =>
        candidate.phase === "lifecycle_intent"
      );
      entry.effect_id = "agent_000099_stop_intent";
    })).toThrow(MaintenanceRefenceError);
    expect(() => replay((candidates) => {
      const entry = candidates.find((candidate) =>
        candidate.effect_id === "agent_000007_process_census"
      );
      entry.effect_id = "agent_000099_process_census";
    })).toThrow(MaintenanceRefenceError);
    expect(() => replay((candidates) => {
      for (const entry of candidates.filter((candidate) =>
        candidate.effect_id === "agent_000006_stop"
      )) entry.effect_id = "agent_000011_stop";
    })).toThrow(MaintenanceRefenceError);
    expect(() => replay((candidates) => {
      const entry = candidates.find((candidate) =>
        candidate.effect_id === "agent_000006_stop" &&
        candidate.phase === "settled"
      );
      entry.detail_sha256 = sha256("wrong-settlement");
    })).toThrow(MaintenanceRefenceError);
    expect(() => replay((candidates) => {
      const entry = candidates.find((candidate) =>
        candidate.effect_id === "agent_000006_stop" &&
        candidate.phase === "verified"
      );
      entry.detail_sha256 = sha256("wrong-verification");
    })).toThrow(MaintenanceRefenceError);

    const firstAttemptingIndex = records.findIndex((entry) =>
      entry.effect_id === "agent_000006_stop" && entry.phase === "attempting"
    );
    const failedRecords = structuredClone(
      records.slice(0, firstAttemptingIndex + 1),
    ) as any[];
    const failedPrevious = failedRecords.at(-1)!;
    failedRecords.push({
      ...failedPrevious,
      ordinal: failedPrevious.ordinal + 1,
      prior_entry_sha256: sha256(`${canonicalJson(failedPrevious)}\n`),
      recorded_at: "2026-08-26T09:47:24Z",
      phase: "failed_or_uncertain",
      detail_sha256: failedPrevious.argv_sha256,
      failure_code: "fly_agent_stop_uncertain",
    });
    expect(() => validateRecords(failedRecords)).not.toThrow();
    const wrongFailedRecords = structuredClone(failedRecords) as any[];
    wrongFailedRecords.at(-1)!.detail_sha256 = sha256("wrong-failed");
    rehash(wrongFailedRecords);
    expect(() => validateRecords(wrongFailedRecords))
      .toThrow(MaintenanceRefenceError);

    const refuseTerminalComplete = (prefix: any[]) => {
      const candidates = structuredClone(prefix) as any[];
      const previous = candidates.at(-1)!;
      candidates.push({
        ...previous,
        ordinal: previous.ordinal + 1,
        prior_entry_sha256: sha256(`${canonicalJson(previous)}\n`),
        recorded_at: "2026-08-26T09:47:29Z",
        phase: "complete",
        checkpoint: "controller_complete",
        effect_id: null,
        effect_kind: null,
        target: null,
        argv_sha256: null,
        pid: null,
        pgid: null,
        exit_code: null,
        termination: null,
        local_process_group_settled: true,
        provider_transition_sha256: null,
        fleet_readback_sha256: null,
        detail_sha256: digest("d"),
        failure_code: null,
      });
      const accepted: any[] = [];
      for (const candidate of candidates) {
        contract.validateControllerWalEntry(
          candidate,
          accepted.at(-1) ?? null,
          accepted,
          expected,
        );
        accepted.push(candidate);
      }
    };
    expect(() => refuseTerminalComplete(
      records.slice(0, firstStopVerified.ordinal),
    )).toThrow(MaintenanceRefenceError);
    for (const completedReboundGroups of [0, 1, 2, 3]) {
      const count = secondIntent.ordinal + completedReboundGroups * 4;
      expect(
        () => refuseTerminalComplete(records.slice(0, count)),
        `second lifecycle terminal after ${completedReboundGroups} rebound groups`,
      ).toThrow(MaintenanceRefenceError);
    }
    const threeLifecycleHistory = structuredClone(
      records.slice(0, -1),
    ) as any[];
    const sourceThird = threeLifecycleHistory.filter((entry) =>
      entry.effect_id === "agent_000015_stop_intent" ||
      entry.effect_id === "agent_000015_stop"
    );
    const thirdBatchID = `cordoned_runtime_${"c".repeat(24)}`;
    const thirdIntent = structuredClone(sourceThird[0]);
    thirdIntent.ordinal = threeLifecycleHistory.at(-1)!.ordinal + 1;
    thirdIntent.prior_entry_sha256 = sha256(
      `${canonicalJson(threeLifecycleHistory.at(-1)!)}\n`,
    );
    thirdIntent.effect_id = "agent_000024_stop_intent";
    thirdIntent.target = thirdBatchID;
    threeLifecycleHistory.push(thirdIntent);
    const thirdIntentSHA256 = sha256(`${canonicalJson(thirdIntent)}\n`);
    for (const source of sourceThird.slice(1)) {
      const entry = structuredClone(source);
      entry.ordinal = threeLifecycleHistory.at(-1)!.ordinal + 1;
      entry.prior_entry_sha256 = sha256(
        `${canonicalJson(threeLifecycleHistory.at(-1)!)}\n`,
      );
      entry.effect_id = "agent_000024_stop";
      entry.target = thirdBatchID;
      if (entry.phase === "attempting") entry.detail_sha256 = thirdIntentSHA256;
      threeLifecycleHistory.push(entry);
    }
    const threePrevious = threeLifecycleHistory.at(-1)!;
    const threeComplete = {
      ...records.at(-1)!,
      ordinal: threePrevious.ordinal + 1,
      prior_entry_sha256: sha256(`${canonicalJson(threePrevious)}\n`),
    };
    expect(() => contract.validateControllerWalEntry(
      threeComplete,
      threePrevious,
      threeLifecycleHistory,
      expected,
    )).toThrow(MaintenanceRefenceError);

    const wrongRequests = [
      {
        effectID: "wrong_build",
        effectKind: "build_push" as const,
        checkpoint: "cordoned_runtime_cleanup_intent_rebound",
        target: "agenttool",
      },
      {
        effectID: "wrong_fleet",
        effectKind: "read_fleet" as const,
        checkpoint: "cordoned_runtime_cleanup_intent_rebound",
        target: "local_fly_ssh_agent",
      },
      {
        effectID: "agent_000003_process_census",
        effectKind: "read_process" as const,
        checkpoint: "wrong_checkpoint",
        target: "local_fly_ssh_agent",
      },
      {
        effectID: "agent_000003_process_census",
        effectKind: "read_process" as const,
        checkpoint: "cordoned_runtime_cleanup_intent_rebound",
        target: "wrong_target",
      },
    ];
    for (const wrong of wrongRequests) {
      const isolatedDirectory = realpathSync(
        mkdtempSync(join(tmpdir(), "refence-agent-wal-wrong-")),
      );
      temporaryDirectories.push(isolatedDirectory);
      chownSync(
        isolatedDirectory,
        process.getuid!(),
        process.getgid!(),
      );
      chmodSync(isolatedDirectory, 0o700);
      const isolated = new ControllerWalWriter({
        directory: isolatedDirectory,
        ...expected,
      });
      for (const entry of records.slice(0, intent.ordinal)) {
        isolated.append({
          recorded_at: entry.recorded_at,
          phase: entry.phase,
          checkpoint: entry.checkpoint,
          effect_id: entry.effect_id,
          effect_kind: entry.effect_kind,
          target: entry.target,
          argv_sha256: entry.argv_sha256,
          pid: entry.pid,
          pgid: entry.pgid,
          exit_code: entry.exit_code,
          termination: entry.termination,
          local_process_group_settled: entry.local_process_group_settled,
          provider_transition_sha256: entry.provider_transition_sha256,
          fleet_readback_sha256: entry.fleet_readback_sha256,
          detail_sha256: entry.detail_sha256,
          failure_code: entry.failure_code,
        });
      }
      await expect(executeControllerEffectToSettlement({
        wal: isolated,
        runtime,
        ...wrong,
        argv: ["/bin/ps"],
        timeoutMilliseconds: 30_000,
        acceptedExitCodes: [0],
      })).rejects.toBeInstanceOf(MaintenanceRefenceError);
    }
    const noIntentDirectory = realpathSync(
      mkdtempSync(join(tmpdir(), "refence-agent-wal-no-intent-")),
    );
    temporaryDirectories.push(noIntentDirectory);
    chownSync(noIntentDirectory, process.getuid!(), process.getgid!());
    chmodSync(noIntentDirectory, 0o700);
    const noIntent = new ControllerWalWriter({
      directory: noIntentDirectory,
      ...expected,
    });
    for (const entry of records.slice(0, intent.ordinal - 1)) {
      noIntent.append({
        recorded_at: entry.recorded_at,
        phase: entry.phase,
        checkpoint: entry.checkpoint,
        effect_id: entry.effect_id,
        effect_kind: entry.effect_kind,
        target: entry.target,
        argv_sha256: entry.argv_sha256,
        pid: entry.pid,
        pgid: entry.pgid,
        exit_code: entry.exit_code,
        termination: entry.termination,
        local_process_group_settled: entry.local_process_group_settled,
        provider_transition_sha256: entry.provider_transition_sha256,
        fleet_readback_sha256: entry.fleet_readback_sha256,
        detail_sha256: entry.detail_sha256,
        failure_code: entry.failure_code,
      });
    }
    await expect(executeControllerEffectToSettlement({
      wal: noIntent,
      runtime,
      effectID: "agent_000006_stop",
      effectKind: "local_agent_stop",
      checkpoint: "fly_agent_cleanup_stop_direct_unix_protocol_child_spawn_count_0",
      target: batchID,
      argv: ["direct-unix-protocol"],
      timeoutMilliseconds: 30_000,
      durableIntentSHA256: intentSHA256,
      acceptedExitCodes: [0],
    })).rejects.toBeInstanceOf(MaintenanceRefenceError);

    expect(() => wal.append({
      recorded_at: "2026-08-26T09:47:31Z",
      phase: "lifecycle_intent",
      checkpoint: "fly_agent_cleanup_stop_intent_direct_unix_protocol",
      effect_id: "agent_000024_stop_intent",
      effect_kind: "local_agent_stop",
      target: `cordoned_runtime_${"c".repeat(24)}`,
      argv_sha256: sha256(canonicalJson(stopArgv)),
      pid: null,
      pgid: null,
      exit_code: null,
      termination: null,
      local_process_group_settled: true,
      provider_transition_sha256: null,
      fleet_readback_sha256: null,
      detail_sha256: digest("e"),
      failure_code: null,
    })).toThrow(MaintenanceRefenceError);
  });

  test("source binds umask-derived 0700 socket and exact lsof holder forms", () => {
    const bridgeSource = readFileSync(
      join(import.meta.dir, "..", "phase-b-refence-maintenance-bridge.ts"),
      "utf8",
    );
    const contractSource = readFileSync(CONTRACT_PATH, "utf8");
    expect(bridgeSource).toContain("const OWNED_FLY_AGENT_SOCKET_MODE = 0o700;");
    expect(bridgeSource).toContain('"pftnDi"');
    expect(contractSource).toContain('entry.type === (metadata.type === "file" ? "REG" : "unix")');
    expect(contractSource).toContain("entry.device === null && entry.inode === null");
    expect(contractSource).toContain("const flyRows = rows.filter");
    expect(contractSource).toContain("(?:fly|flyctl)");
    expect(bridgeSource).not.toContain("agent run (~\\/.fly");
    expect(contractSource).not.toContain("agent run (~\\/.fly");
  });
});

describe("strict target public and final authority contracts", () => {
  test("pins one bounded canonical public-observation child contract", () => {
    const observation = publicHealthObservation(revision("a"));
    const bytes = new TextEncoder().encode(`${canonicalJson(observation)}\n`);
    expect(parseControllerPublicObservationForTest(bytes)).toEqual(
      observation,
    );
    const argv = controllerPublicHTTPArgvForTest(
      "https://api.agenttool.dev/health",
    );
    expect(argv.slice(1, 6)).toEqual([
      "--no-install",
      "--no-env-file",
      "--config=/dev/null",
      "--cwd=/",
      "-e",
    ]);
    expect(argv.slice(-2)).toEqual([
      "--",
      "https://api.agenttool.dev/health",
    ]);
    const program = argv[6]!;
    expect(Buffer.byteLength(program)).toBeLessThanOrEqual(4_096);
    expect(program).not.toMatch(/[\0\r\n]/);
    expect(program).toContain('redirect:"manual"');
    expect(program).toContain('cache:"no-store"');
    expect(program).toContain("new AbortController()");
    expect(program).toContain("await reader.cancel()");
    expect(program).toContain("await Bun.write(Bun.stdout,output)");
    expect(program.match(/process\.exit\(1\)/g)).toHaveLength(1);
    expect(() => controllerPublicHTTPArgvForTest("http://127.0.0.1"))
      .toThrow();
    for (
      const mutate of [
        (value: Uint8Array) => new Uint8Array(value.slice(0, -1)),
        (value: Uint8Array) =>
          new TextEncoder().encode(
            new TextDecoder().decode(value).replace(/\n$/, "\r\n"),
          ),
        (_value: Uint8Array) => new TextEncoder().encode("{}\n"),
        (_value: Uint8Array) => new Uint8Array(1_500_001),
      ]
    ) {
      expect(() => parseControllerPublicObservationForTest(mutate(bytes)))
        .toThrow();
    }
  });

  test("normalizes only the valid health probe time and rejects every shape drift", () => {
    const targetRevision = revision("a");
    const first = publicHealthObservation(targetRevision);
    const second = publicHealthObservation(targetRevision, 1_888_888_888_888);
    const expected = validateControllerPublicHealthForTest(
      first,
      targetRevision,
    );
    expect(validateControllerPublicHealthForTest(second, targetRevision)).toBe(
      expected,
    );
    for (const key of Object.keys(first.body)) {
      const mutation = structuredClone(first);
      delete mutation.body[key];
      expect(() =>
        validateControllerPublicHealthForTest(mutation, targetRevision)
      ).toThrow();
    }
    for (
      const path of [
        ["build", "dirty"],
        ["build", "revision"],
        ["walls", "declared"],
        ["walls", "intact"],
        ["walls", "probed_at_unix_ms"],
        ["walls", "probes"],
      ] as const
    ) {
      const mutation = structuredClone(first);
      delete mutation.body[path[0]][path[1]];
      expect(() =>
        validateControllerPublicHealthForTest(mutation, targetRevision)
      ).toThrow();
    }
    for (let index = 0; index < 3; index += 1) {
      for (const key of ["method", "ok", "wall"]) {
        const mutation = structuredClone(first);
        delete mutation.body.walls.probes[index][key];
        expect(() =>
          validateControllerPublicHealthForTest(mutation, targetRevision)
        ).toThrow();
      }
    }
    const mutations = [
      (value: any) => {
        value.body.extra = true;
      },
      (value: any) => {
        value.body.build.extra = true;
      },
      (value: any) => {
        value.body.walls.extra = true;
      },
      (value: any) => {
        value.body.build.revision = revision("b");
      },
      (value: any) => {
        value.body.build.dirty = true;
      },
      (value: any) => {
        value.body.covenant_v2_authority = "configured";
      },
      (value: any) => {
        value.cacheControl = null;
      },
      (value: any) => {
        value.body.walls.probed_at_unix_ms = 0;
      },
      (value: any) => {
        value.body.walls.probed_at_unix_ms += 0.5;
      },
      (value: any) => {
        value.body.walls.declared.reverse();
      },
      (value: any) => {
        value.body.walls.probes.reverse();
      },
      (value: any) => {
        value.body.walls.probes[0].ok = false;
      },
    ];
    for (const mutate of mutations) {
      const mutation = structuredClone(first);
      mutate(mutation);
      expect(() =>
        validateControllerPublicHealthForTest(mutation, targetRevision)
      ).toThrow();
    }
  });

  test("normalizes only a fresh welcome and pins the target origin", () => {
    const first = publicAboutObservation();
    const second = publicAboutObservation(1_777_777_777_800);
    const expected = validateControllerPublicFederationAboutForTest(first);
    expect(validateControllerPublicFederationAboutForTest(second)).toBe(
      expected,
    );
    expect(validateControllerPublicFederationAboutForTest(
      publicAboutObservation(
        first.observationStartedAtUnixMs - 8_000,
        first.observationStartedAtUnixMs,
        first.observationSettledAtUnixMs,
      ),
    )).toBe(expected);
    expect(validateControllerPublicFederationAboutForTest(
      publicAboutObservation(
        first.observationSettledAtUnixMs + 8_000,
        first.observationStartedAtUnixMs,
        first.observationSettledAtUnixMs,
      ),
    )).toBe(expected);
    for (const key of Object.keys(first.body)) {
      const mutation = structuredClone(first);
      delete mutation.body[key];
      expect(() => validateControllerPublicFederationAboutForTest(mutation))
        .toThrow();
    }
    for (
      const [parent, keys] of [
        ["federation", Object.keys(first.body.federation)],
        ["capabilities", Object.keys(first.body.capabilities)],
        ["pyramid_peer_surface", Object.keys(first.body.pyramid_peer_surface)],
        ["did_format", Object.keys(first.body.did_format)],
        ["_welcomed", Object.keys(first.body._welcomed)],
      ] as const
    ) {
      for (const key of keys) {
        const mutation = structuredClone(first);
        delete mutation.body[parent][key];
        expect(() => validateControllerPublicFederationAboutForTest(mutation))
          .toThrow();
      }
      const mutation = structuredClone(first);
      mutation.body[parent].extra = true;
      expect(() => validateControllerPublicFederationAboutForTest(mutation))
        .toThrow();
    }
    const mutations = [
      (value: any) => {
        value.body.extra = true;
      },
      (value: any) => {
        value.body.federation.instance_url = "https://agenttool.fly.dev";
      },
      (value: any) => {
        value.body.federation.enabled = true;
      },
      (value: any) => {
        value.body.federation.open = true;
      },
      (value: any) => {
        value.body.federation.allowed_origins = ["https://peer.invalid"];
      },
      (value: any) => {
        value.body.capabilities.inbox = true;
      },
      (value: any) => {
        value.body.covenant_v2_authority = "configured";
      },
      (value: any) => {
        value.body._welcomed.walls_held = [3, 6];
      },
      (value: any) => {
        value.cacheControl = "no-store";
      },
      (value: any) => {
        value.body._welcomed.at_unix_ms = value.observationStartedAtUnixMs -
          8_001;
      },
      (value: any) => {
        value.body._welcomed.at_unix_ms = value.observationSettledAtUnixMs +
          8_001;
      },
      (value: any) => {
        value.observationStartedAtUnixMs += 0.5;
      },
      (value: any) => {
        value.observationSettledAtUnixMs = value.observationStartedAtUnixMs - 1;
      },
      (value: any) => {
        value.observationSettledAtUnixMs = Number.MAX_SAFE_INTEGER;
      },
    ];
    for (const mutate of mutations) {
      const mutation = structuredClone(first);
      mutate(mutation);
      expect(() => validateControllerPublicFederationAboutForTest(mutation))
        .toThrow();
    }
  });

  test("accepts only the exact first-canary three-round trace", () => {
    const targetRevision = revision("a");
    const events = firstCanaryEvents();
    const proof = validateControllerFirstCanaryPublicForTest({
      targetRevision,
      events,
    });
    expect(Object.keys(proof).sort()).toEqual([
      "authority_state",
      "checkpoint",
      "federation_about_projection_sha256",
      "federation_instance_url_sha256",
      "fleet_before_after_equal",
      "fleet_sample_count",
      "health_projection_sha256",
      "pause_count",
      "pause_milliseconds",
      "public_contract_projection_all_rounds_equal",
      "public_observation_count",
      "public_round_count",
      "public_sandwich_sha256",
      "schema",
      "stable_fleet_sha256",
      "target_revision",
      "verified",
    ]);
    expect(proof).toMatchObject({
      schema: "agenttool-phase-b-refence-first-canary-public/v1",
      checkpoint: "first_canary",
      public_round_count: 3,
      public_observation_count: 6,
      pause_count: 2,
      pause_milliseconds: 2_000,
      verified: true,
    });
    const mutations = [
      (value: any[]) => value.pop(),
      (value: any[]) => value.push(structuredClone(value.at(-1))),
      (value: any[]) => [value[1], value[2]] = [value[2], value[1]],
      (value: any[]) => value[3].milliseconds = 1_999,
      (value: any[]) => value[6].milliseconds = 2_001,
      (value: any[]) => value[4].proof_sha256 = digest("a"),
      (value: any[]) => value[5].proof_sha256 = digest("b"),
      (value: any[]) => value[9].proof_sha256 = digest("c"),
      (value: any[]) => value[0].extra = true,
    ];
    for (const mutate of mutations) {
      const changed = structuredClone(events);
      mutate(changed);
      expect(() =>
        validateControllerFirstCanaryPublicForTest({
          targetRevision,
          events: changed,
        })
      ).toThrow();
    }
  });

  test("executes the exact first-canary fleet-(health,about)x3-fleet order", async () => {
    const target = cordonedTargetRuntimeFixture();
    target.fleet.find((machine) => machine.id === roles.app_lhr[0])!.cordoned =
      false;
    target.expectation.uncordonedAppMachineIDs = [roles.app_lhr[0]];
    const expectedFleetSHA256 = fullFleetSHA256(target.fleet);
    const calls: string[] = [];
    let publicOrdinal = 0;
    const proof = await runControllerFirstCanaryPublicCoreForTest({
      evidence: target.fixture.evidence,
      image: target.targetImage,
      expectation: target.expectation,
      expectedFleetSHA256,
      dependencies: {
        readFleetInventory: async () => {
          calls.push("fleet");
          return structuredClone(target.fleet);
        },
        readPublicJson: async (url, checkpoint) => {
          calls.push(checkpoint);
          const ordinal = publicOrdinal++;
          const round = Math.floor(ordinal / 2);
          const roundStartedAtUnixMs = 1_777_777_777_000 + round * 2_300;
          return url.endsWith("/health")
            ? publicHealthObservation(
              target.fixture.evidence.targetRevision,
              1_777_777_777_777 + ordinal,
              roundStartedAtUnixMs,
              roundStartedAtUnixMs + 100,
            )
            : publicAboutObservation(
              roundStartedAtUnixMs + 250,
              roundStartedAtUnixMs + 200,
              roundStartedAtUnixMs + 300,
            );
        },
        pause: async (milliseconds) => {
          expect(milliseconds).toBe(2_000);
          calls.push("pause:2000");
        },
      },
    });
    expect(calls).toEqual([
      "fleet",
      "first_canary_health_0",
      "first_canary_about_0",
      "pause:2000",
      "first_canary_health_1",
      "first_canary_about_1",
      "pause:2000",
      "first_canary_health_2",
      "first_canary_about_2",
      "fleet",
    ]);
    expect(proof).toMatchObject({
      schema: "agenttool-phase-b-refence-first-canary-public/v1",
      stable_fleet_sha256: expectedFleetSHA256,
      public_observation_count: 6,
      verified: true,
    });
  });

  test("requires each canary observation gap to be at least exactly 2000ms", async () => {
    const target = cordonedTargetRuntimeFixture();
    target.fleet.find((machine) => machine.id === roles.app_lhr[0])!.cordoned =
      false;
    target.expectation.uncordonedAppMachineIDs = [roles.app_lhr[0]];
    const expectedFleetSHA256 = fullFleetSHA256(target.fleet);
    const base = 1_777_777_777_000;
    const run = async (roundStarts: readonly number[]) => {
      let publicOrdinal = 0;
      return runControllerFirstCanaryPublicCoreForTest({
        evidence: target.fixture.evidence,
        image: target.targetImage,
        expectation: target.expectation,
        expectedFleetSHA256,
        dependencies: {
          readFleetInventory: async () => structuredClone(target.fleet),
          readPublicJson: async (url) => {
            const ordinal = publicOrdinal++;
            const started = roundStarts[Math.floor(ordinal / 2)]!;
            return url.endsWith("/health")
              ? publicHealthObservation(
                target.fixture.evidence.targetRevision,
                base + ordinal,
                started,
                started + 100,
              )
              : publicAboutObservation(
                started + 250,
                started + 200,
                started + 300,
              );
          },
          pause: async (milliseconds) => expect(milliseconds).toBe(2_000),
        },
      });
    };
    await expect(run([base, base + 2_300, base + 4_600])).resolves
      .toMatchObject({ verified: true });
    await expect(run([base, base + 2_299, base + 4_599])).rejects.toThrow(
      MaintenanceRefenceError,
    );
    await expect(run([base, base + 2_300, base + 4_599])).rejects.toThrow(
      MaintenanceRefenceError,
    );
  });

  test("executes the indivisible final local-public-DB-local sandwich", async () => {
    const target = cordonedTargetRuntimeFixture();
    for (const machineID of [...roles.app_lhr, roles.app_cdg]) {
      target.fleet.find((machine) => machine.id === machineID)!.cordoned =
        false;
    }
    target.expectation.uncordonedAppMachineIDs = [
      ...roles.app_lhr,
      roles.app_cdg,
    ];
    const expectedFleetSHA256 = fullFleetSHA256(target.fleet);
    const expectedDatabaseUpdatedAt = "2026-08-25T12:00:00.000000Z";
    const database = structuredClone(target.fixture.database);
    database.federation_instance_url_sha256 = TARGET_URL_SHA256;
    database.federation_updated_at = expectedDatabaseUpdatedAt;
    const calls: string[] = [];
    let localCount = 0;
    let gitCount = 0;
    let keychainCount = 0;
    let providerCount = 0;
    let fleetCount = 0;
    const result = await runControllerFinalAuthorityCoreForTest({
      evidence: target.fixture.evidence,
      image: target.targetImage,
      expectation: target.expectation,
      expectedFleetSHA256,
      expectedDatabaseUpdatedAt,
      dependencies: {
        readEvidence: () => {
          calls.push(localCount++ === 0 ? "local_before" : "local_after");
          return structuredClone(target.fixture.evidence);
        },
        readGitProof: async () => {
          calls.push(gitCount++ === 0 ? "git_before" : "git_after");
          return protectedSuccessorGitProof(target.fixture.evidence);
        },
        readKeychainProof: async () => {
          calls.push(
            keychainCount++ === 0 ? "keychain_before" : "keychain_after",
          );
          return {
            generation_absent: true,
            machine_map_sha256:
              "8c27bb32b5306ebdc4fa4b630d58cd098203c0dd762ee2f0f42e73c9aef5c8d1",
            roles,
          };
        },
        readProviderSecretInventory: async () => {
          calls.push(
            providerCount++ === 0 ? "provider_before" : "provider_after",
          );
          return [];
        },
        readDeployedProcessProof: async (checkpoint) => {
          calls.push(checkpoint);
          return digest("a");
        },
        readFleetInventory: async () => {
          calls.push(fleetCount++ === 0 ? "fleet_before" : "fleet_after");
          return structuredClone(target.fleet);
        },
        readPublicJson: async (url, checkpoint) => {
          calls.push(checkpoint);
          return url.endsWith("/health")
            ? publicHealthObservation(target.fixture.evidence.targetRevision)
            : publicAboutObservation();
        },
        readDatabaseProof: async () => {
          calls.push("database");
          return structuredClone(database);
        },
      },
    });
    expect(calls).toEqual([
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
    ]);
    expect(result.publicProofSHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.authorityProofSHA256).toMatch(/^[0-9a-f]{64}$/);
  });

  test("accepts only the indivisible mirrored final authority sandwich", () => {
    const request = {
      targetRevision: revision("a"),
      targetTree: revision("b"),
      expectedDatabaseUpdatedAt: "2026-08-25T12:00:00.123456Z",
      databaseInstanceURLSHA256:
        "beb8e35af063f5f2619474d6af1757bca1b0cddc801842d39cdf0bb1ada8f37d",
      databaseUpdatedAt: "2026-08-25T12:00:00.123456Z",
      databaseTargetSHA256: digest("d"),
      events: finalAuthorityEvents(),
    };
    const result = validateControllerFinalAuthorityForTest(request);
    expect(Object.keys(result.publicProof).sort()).toEqual([
      "authority_state",
      "checkpoint",
      "federation_about_projection_sha256",
      "federation_instance_url_sha256",
      "health_projection_sha256",
      "public_contract_projection_before_after_equal",
      "public_observation_count",
      "schema",
      "target_revision",
      "verified",
    ]);
    expect(Object.keys(result.authorityProof).sort()).toEqual([
      "authority_pair_count",
      "authority_sandwich_sha256",
      "authority_state",
      "checkpoint",
      "database_federation_updated_at",
      "database_instance_url_sha256",
      "database_observation_count",
      "database_proof_sha256",
      "database_target_sha256",
      "git_proof_sha256",
      "keychain_proof_sha256",
      "local_evidence_sha256",
      "process_proof_sha256",
      "provider_inventory_sha256",
      "public_proof_sha256",
      "schema",
      "stable_fleet_sha256",
      "target_revision",
      "target_tree",
      "verified",
    ]);
    for (let index = 0; index < request.events.length - 1; index += 1) {
      const changed = structuredClone(request);
      [changed.events[index], changed.events[index + 1]] = [
        changed.events[index + 1],
        changed.events[index],
      ];
      expect(() => validateControllerFinalAuthorityForTest(changed)).toThrow();
    }
    for (const index of [9, 10, 11, 12, 13, 14, 15, 16]) {
      const changed = structuredClone(request);
      changed.events[index].proof_sha256 = digest("e");
      expect(() => validateControllerFinalAuthorityForTest(changed)).toThrow();
    }
    const mutations = [
      (value: any) => value.events.splice(8, 1),
      (value: any) =>
        value.events.splice(8, 0, structuredClone(value.events[8])),
      (value: any) => value.events[0].extra = true,
      (value: any) => value.databaseInstanceURLSHA256 = digest("f"),
      (value: any) => value.databaseUpdatedAt = "2026-08-25T12:00:00.123457Z",
      (value: any) => value.expectedDatabaseUpdatedAt = "2026-08-25T12:00:00Z",
      (value: any) => value.databaseTargetSHA256 = "bad",
    ];
    for (const mutate of mutations) {
      const changed = structuredClone(request);
      mutate(changed);
      expect(() => validateControllerFinalAuthorityForTest(changed)).toThrow();
    }
  });
});

describe("single-process controller rollout order", () => {
  test("starts primary after app autostart and gates the first canary", async () => {
    const fixture = guardFixture();
    const events: string[] = [];
    const expectations: Array<{
      operation: ControllerFlyOperation;
      expectation: any;
    }> = [];
    let fakeFleetSHA256 = digest("9");
    const targetImage = {
      tag: fixture.request.rolloutID,
      digest: `sha256:${digest("a")}`,
      revision: fixture.request.targetRevision,
    };
    const receipt = await runControllerRolloutCore({
      evidence: fixture.evidence,
      rolloutID: fixture.request.rolloutID,
      dependencies: {
        recordCheckpoint: async (checkpoint) => {
          events.push(`checkpoint:${checkpoint}`);
        },
        runSpecialGuard: async (checkpoint) => {
          events.push(`guard:${checkpoint}`);
          return {
            proofSHA256: digest("1"),
            fleetSHA256: fakeFleetSHA256,
          };
        },
        performFlyOperation: async (
          operation,
          expectation,
          expectedPreFleetSHA256,
        ) => {
          expect(expectedPreFleetSHA256).toBe(fakeFleetSHA256);
          const target = "machineID" in operation
            ? operation.machineID
            : "agenttool";
          events.push(`fly:${operation.kind}:${target}`);
          expectations.push({
            operation: structuredClone(operation),
            expectation: structuredClone(expectation),
          });
          fakeFleetSHA256 = sha256(canonicalJson({
            operation,
            expectation,
            ordinal: expectations.length,
          }));
          return {
            ...(operation.kind === "update_image" &&
                target === roles.thinker_primary
              ? { image: targetImage }
              : {}),
            proofSHA256: digest("2"),
            fleetSHA256: fakeFleetSHA256,
          };
        },
        proveCordonedRuntime: async (started) => {
          events.push(`runtime:${started.join(",")}`);
          return { proofSHA256: digest("3"), cleanupSHA256: digest("a") };
        },
        proveFirstCanaryPublic: async () => {
          events.push("public:first_canary");
          return digest("4");
        },
        proveFinalAuthorityAndPublic: async () => {
          events.push("final-authority-public");
          return {
            publicProofSHA256: digest("5"),
            authorityProofSHA256: digest("6"),
            cleanupSHA256: digest("b"),
          };
        },
        runOrdinaryAbsentPostflight: async () => {
          events.push("ordinary-absent-postflight");
          return digest("7");
        },
        finalizeSuccess: async (proofs, lifecycle) => {
          events.push("success-finalization");
          expect(proofs.final_absence_sha256).toBeNull();
          proofs.final_absence_sha256 = sha256("final-agent-absence");
          lifecycle.effectsClosed();
          lifecycle.a0Installed();
          return {
            receiptPath:
              "/Users/yournameisai/.local/state/agenttool/deploy-receipts/20260825T120000Z-d87a3f35c80b-1.json",
            receiptSHA256: digest("8"),
            witnessPath:
              `/Users/yournameisai/.local/state/agenttool/deploy-state/phase-b-refence-maintenance-finalization-${fixture.evidence.runID}.json`,
            witnessSHA256: digest("9"),
          };
        },
        recoverToStoppedFence: async () => {
          throw new Error("recovery must not run");
        },
        retainManualBlocker: async () => {
          throw new Error("manual lane must not run");
        },
        retainFinalizationManualBlocker: async () => {
          throw new Error("finalization manual lane must not run");
        },
      },
    });
    expect(receipt.receiptSHA256).toBe(digest("8"));
    const primaryStart = events.indexOf(
      `fly:start:${roles.thinker_primary}`,
    );
    const lastAppAutostart = Math.max(...[...roles.app_lhr, roles.app_cdg].map(
      (id) => events.indexOf(`fly:enable_autostart:${id}`),
    ));
    expect(primaryStart).toBeGreaterThan(lastAppAutostart);
    expect(events).not.toContain(`fly:start:${roles.thinker_standby}`);
    const primaryStartExpectation =
      expectations.find((entry) =>
        entry.operation.kind === "start" &&
        "machineID" in entry.operation &&
        entry.operation.machineID === roles.thinker_primary
      )!.expectation;
    expect(primaryStartExpectation.startedMachineIDs).toEqual([
      ...roles.app_lhr,
      roles.app_cdg,
      roles.thinker_primary,
    ]);
    const firstUncordon = events.indexOf(`fly:uncordon:${roles.app_lhr[0]}`);
    const canaryPublic = events.indexOf("public:first_canary");
    const secondUncordon = events.indexOf(`fly:uncordon:${roles.app_lhr[1]}`);
    expect(firstUncordon).toBeLessThan(canaryPublic);
    expect(canaryPublic).toBeLessThan(secondUncordon);
    expect(events.at(-1)).toBe("success-finalization");
  });

  test("every post-A0 finalization cut bypasses all later rollout dependencies", async () => {
    for (const point of FINALIZATION_CRASH_POINTS) {
      const fixture = guardFixture();
      const finalization = finalizationTestFixture();
      expect(finalization.authorityRequest.controllerRunID).toBe(
        fixture.evidence.runID,
      );
      expect(finalization.authorityRequest.rolloutID).toBe(
        fixture.request.rolloutID,
      );
      expect(finalization.authorityRequest.refenceReceiptSHA256).toBe(
        fixture.evidence.receiptSHA256,
      );
      expect(finalization.authorityRequest.sourceRevision).toBe(
        fixture.evidence.targetRevision,
      );
      expect(finalization.authorityRequest.sourceTree).toBe(
        fixture.evidence.targetTree,
      );
      let fleetSHA256 = digest("9");
      let finalizationActive = false;
      let effectOrdinal = 0;
      const calls: string[] = [];
      const callsAfterFinalization: string[] = [];
      const observedPoints: SuccessFinalizationCrashPoint[] = [];
      const note = (name: string): void => {
        calls.push(name);
        if (finalizationActive) callsAfterFinalization.push(name);
      };
      const targetImage = {
        tag: fixture.request.rolloutID,
        digest: `sha256:${digest("a")}`,
        revision: fixture.request.targetRevision,
      };
      try {
        await expect(runControllerRolloutCore({
          evidence: fixture.evidence,
          rolloutID: fixture.request.rolloutID,
          dependencies: {
            recordCheckpoint: async (checkpoint) =>
              note(`checkpoint:${checkpoint}`),
            runSpecialGuard: async (checkpoint) => {
              note(`guard:${checkpoint}`);
              return {
                proofSHA256:
                  finalization.authorityRequest.rolloutProofs.special_guards[
                    checkpoint === "prepublication_before_build" ? 0 : 1
                  ],
                fleetSHA256,
              };
            },
            performFlyOperation: async (
              operation,
              expectation,
              expectedPreFleetSHA256,
            ) => {
              note(`fly:${operation.kind}`);
              expect(expectedPreFleetSHA256).toBe(fleetSHA256);
              const expectedEffect =
                finalization.authorityRequest.rolloutProofs.fly_effects[
                  effectOrdinal++
                ];
              expect({
                operation: operation.kind,
                target: "machineID" in operation
                  ? operation.machineID
                  : "agenttool",
              }).toEqual({
                operation: expectedEffect.operation,
                target: expectedEffect.target,
              });
              fleetSHA256 = sha256(canonicalJson({
                fleetSHA256,
                operation,
                expectation,
              }));
              return {
                ...(operation.kind === "update_image" &&
                    "machineID" in operation &&
                    operation.machineID === roles.thinker_primary
                  ? { image: targetImage }
                  : {}),
                proofSHA256: expectedEffect.proof_sha256,
                fleetSHA256,
              };
            },
            proveCordonedRuntime: async () => {
              note("runtime");
              return {
                proofSHA256: finalization.authorityRequest.rolloutProofs
                  .cordoned_runtime_sha256,
                cleanupSHA256: finalization.authorityRequest.rolloutProofs
                  .cordoned_runtime_agent_cleanup_sha256,
              };
            },
            proveFirstCanaryPublic: async () => {
              note("first-canary");
              return finalization.authorityRequest.rolloutProofs
                .public_first_canary_sha256;
            },
            proveFinalAuthorityAndPublic: async () => {
              note("final-authority");
              return {
                publicProofSHA256: finalization.authorityRequest.rolloutProofs
                  .public_final_sha256,
                authorityProofSHA256:
                  finalization.authorityRequest.rolloutProofs
                    .final_authority_sha256,
                cleanupSHA256:
                  finalization.authorityRequest.rolloutProofs
                    .final_authority_agent_cleanup_sha256,
              };
            },
            runOrdinaryAbsentPostflight: async () => {
              note("ordinary-postflight");
              return finalization.authorityRequest.rolloutProofs
                .ordinary_absent_postflight_sha256;
            },
            finalizeSuccess: async (proofs, lifecycle) => {
              calls.push("finalize");
              expect(proofs.final_absence_sha256).toBeNull();
              proofs.final_absence_sha256 = finalization.authorityRequest
                .rolloutProofs.final_absence_sha256;
              expect(canonicalJson(proofs)).toBe(
                canonicalJson(finalization.authorityRequest.rolloutProofs),
              );
              lifecycle.effectsClosed();
              runFinalizationFixture(finalization, {
                onA0Installed: () => {
                  lifecycle.a0Installed();
                  finalizationActive = true;
                },
                crash: (observed) => {
                  observedPoints.push(observed);
                  if (observed === point) throw new Error(`cut_${point}`);
                },
              });
              throw new Error(`missed_cut_${point}`);
            },
            recoverToStoppedFence: async () => {
              note("recovery");
              return digest("8");
            },
            retainManualBlocker: async () => note("manual"),
            retainFinalizationManualBlocker: async () =>
              note("finalization-manual"),
          },
        })).rejects.toThrow(`cut_${point}`);
        expect(effectOrdinal).toBe(28);
        expect(observedPoints).toEqual(
          FINALIZATION_CRASH_POINTS.slice(
            0,
            FINALIZATION_CRASH_POINTS.indexOf(point) + 1,
          ),
        );
        expect(calls.at(-1)).toBe("finalize");
        expect(callsAfterFinalization).toEqual([]);
        expect(calls).not.toContain("recovery");
        expect(calls).not.toContain("manual");
        expect(calls).not.toContain("finalization-manual");
      } finally {
        closeAbandonedFinalizationLock(finalization);
      }
    }
  });

  test("finalization failures split exactly at effects-closed and durable A0", async () => {
    const cases = [
      ["before_close", 1, 0, 0],
      ["after_close", 0, 0, 1],
      ["after_a0", 0, 0, 0],
      ["a0_directory_close", 0, 0, 0],
      ["returned_without_a0", 0, 0, 1],
    ] as const;
    for (
      const [phase, expectedRecovery, expectedManual, expectedFinalManual]
        of cases
    ) {
      const fixture = guardFixture();
      let fleetSHA256 = digest("9");
      let recovery = 0;
      let manual = 0;
      let finalManual = 0;
      const targetImage = {
        tag: fixture.request.rolloutID,
        digest: `sha256:${digest("a")}`,
        revision: fixture.request.targetRevision,
      };
      const failure = new Error(`failure_${phase}`);
      const promise = runControllerRolloutCore({
        evidence: fixture.evidence,
        rolloutID: fixture.request.rolloutID,
        dependencies: {
          recordCheckpoint: async () => {},
          runSpecialGuard: async () => ({
            proofSHA256: digest("1"),
            fleetSHA256,
          }),
          performFlyOperation: async (operation, expectation) => {
            fleetSHA256 = sha256(canonicalJson({
              fleetSHA256,
              operation,
              expectation,
            }));
            return {
              ...(operation.kind === "update_image" &&
                  "machineID" in operation &&
                  operation.machineID === roles.thinker_primary
                ? { image: targetImage }
                : {}),
              proofSHA256: digest("2"),
              fleetSHA256,
            };
          },
          proveCordonedRuntime: async () => ({ proofSHA256: digest("3"), cleanupSHA256: digest("a") }),
          proveFirstCanaryPublic: async () => digest("4"),
          proveFinalAuthorityAndPublic: async () => ({
            publicProofSHA256: digest("5"),
            authorityProofSHA256: digest("6"),
            cleanupSHA256: digest("b"),
          }),
          runOrdinaryAbsentPostflight: async () => digest("7"),
          finalizeSuccess: async (_proofs, lifecycle) => {
            if (phase === "before_close") throw failure;
            lifecycle.effectsClosed();
            if (phase === "after_close") throw failure;
            if (phase === "after_a0") {
              lifecycle.a0Installed();
              throw failure;
            }
            if (phase === "a0_directory_close") {
              const directory = realpathSync(
                mkdtempSync(join(tmpdir(), "refence-a0-close-")),
              );
              temporaryDirectories.push(directory);
              chmodSync(directory, 0o700);
              const canonicalPath = join(directory, "marker.json");
              const stagePath = join(directory, ".marker.next");
              const current = { checkpoint: "old", schema: "synthetic/v1" };
              const next = { checkpoint: "new", schema: "synthetic/v1" };
              const currentBytes = `${canonicalJson(current)}\n`;
              writeFileSync(canonicalPath, currentBytes, { mode: 0o600 });
              replaceDurableCanonicalJsonCAS({
                canonicalPath,
                directory,
                stagePath,
                expectedCurrentSHA256: sha256(currentBytes),
                nextValue: next,
                verifyAuthority: () => {},
                validateCurrent: (value) => expect(value).toEqual(current),
                validateNext: (value) => expect(value).toEqual(next),
                onDurableInstall: lifecycle.a0Installed,
                fsyncDirectory: (path, afterSync) => {
                  const descriptor = openSync(path, fsConstants.O_RDONLY);
                  fsyncSync(descriptor);
                  afterSync?.();
                  closeSync(descriptor);
                  throw failure;
                },
              });
              throw new Error("a0_close_missed");
            }
            return {
              receiptPath:
                "/Users/yournameisai/.local/state/agenttool/deploy-receipts/20260825T120000Z-aaaaaaaaaaaa-1.json",
              receiptSHA256: digest("8"),
              witnessPath:
                `/Users/yournameisai/.local/state/agenttool/deploy-state/phase-b-refence-maintenance-finalization-${fixture.evidence.runID}.json`,
              witnessSHA256: digest("9"),
            };
          },
          recoverToStoppedFence: async () => {
            recovery += 1;
            return digest("a");
          },
          retainManualBlocker: async () => {
            manual += 1;
          },
          retainFinalizationManualBlocker: async () => {
            finalManual += 1;
          },
        },
      });
      if (phase === "returned_without_a0") {
        await expect(promise).rejects.toThrow(
          "controller_finalization_lifecycle",
        );
      } else await expect(promise).rejects.toBe(failure);
      expect(recovery, phase).toBe(expectedRecovery);
      expect(manual, phase).toBe(expectedManual);
      expect(finalManual, phase).toBe(expectedFinalManual);
    }
  });

  test("an uncertain provider child never launches recovery", async () => {
    const fixture = guardFixture();
    let recoveryCalls = 0;
    let manualCalls = 0;
    await expect(runControllerRolloutCore({
      evidence: fixture.evidence,
      rolloutID: fixture.request.rolloutID,
      dependencies: {
        recordCheckpoint: async () => {},
        runSpecialGuard: async () => ({
          proofSHA256: digest("1"),
          fleetSHA256: digest("9"),
        }),
        performFlyOperation: async () => {
          throw new ControllerManualInterventionError(
            "provider_effect_failed_or_uncertain",
          );
        },
        proveCordonedRuntime: async () => ({ proofSHA256: digest("2"), cleanupSHA256: digest("a") }),
        proveFirstCanaryPublic: async () => digest("3"),
        proveFinalAuthorityAndPublic: async () => ({
          publicProofSHA256: digest("4"),
          authorityProofSHA256: digest("5"),
          cleanupSHA256: digest("b"),
        }),
        runOrdinaryAbsentPostflight: async () => digest("6"),
        finalizeSuccess: async () => ({
          receiptPath:
            "/Users/yournameisai/.local/state/agenttool/deploy-receipts/20260825T120000Z-aaaaaaaaaaaa-1.json",
          receiptSHA256: digest("7"),
          witnessPath:
            `/Users/yournameisai/.local/state/agenttool/deploy-state/phase-b-refence-maintenance-finalization-${fixture.evidence.runID}.json`,
          witnessSHA256: digest("8"),
        }),
        recoverToStoppedFence: async () => {
          recoveryCalls += 1;
          return digest("8");
        },
        retainManualBlocker: async () => {
          manualCalls += 1;
        },
        retainFinalizationManualBlocker: async () => {
          throw new Error("finalization manual lane must not run");
        },
      },
    })).rejects.toBeInstanceOf(ControllerManualInterventionError);
    expect(recoveryCalls).toBe(0);
    expect(manualCalls).toBe(1);
  });

  test("a settled post-uncordon observation refusal re-cordons through exact recovery", async () => {
    for (
      const failureAt of ["first_canary", "final", "postflight"] as const
    ) {
      const fixture = guardFixture();
      let fakeFleetSHA256 = digest("9");
      let recoveryCalls = 0;
      let manualCalls = 0;
      const targetImage = {
        tag: fixture.request.rolloutID,
        digest: `sha256:${digest("a")}`,
        revision: fixture.request.targetRevision,
      };
      await expect(runControllerRolloutCore({
        evidence: fixture.evidence,
        rolloutID: fixture.request.rolloutID,
        dependencies: {
          recordCheckpoint: async () => {},
          runSpecialGuard: async () => ({
            proofSHA256: digest("1"),
            fleetSHA256: fakeFleetSHA256,
          }),
          performFlyOperation: async (operation, expectation) => {
            fakeFleetSHA256 = sha256(canonicalJson({
              operation,
              expectation,
              previous: fakeFleetSHA256,
            }));
            return {
              ...(operation.kind === "update_image" &&
                  "machineID" in operation &&
                  operation.machineID === roles.thinker_primary
                ? { image: targetImage }
                : {}),
              proofSHA256: digest("2"),
              fleetSHA256: fakeFleetSHA256,
            };
          },
          proveCordonedRuntime: async () => ({ proofSHA256: digest("3"), cleanupSHA256: digest("a") }),
          proveFirstCanaryPublic: async () => {
            if (failureAt === "first_canary") {
              throw new ControllerSettledObservationError(
                "public_health_contract",
              );
            }
            return digest("4");
          },
          proveFinalAuthorityAndPublic: async () => {
            if (failureAt === "final") {
              throw new ControllerSettledObservationError(
                "public_about_contract",
              );
            }
            return {
              publicProofSHA256: digest("5"),
              authorityProofSHA256: digest("6"),
              cleanupSHA256: digest("b"),
            };
          },
          runOrdinaryAbsentPostflight: async () => {
            if (failureAt === "postflight") {
              throw new ControllerSettledObservationError(
                "ordinary_postflight_proof",
              );
            }
            return digest("7");
          },
          finalizeSuccess: async () => ({
            receiptPath:
              "/Users/yournameisai/.local/state/agenttool/deploy-receipts/20260825T120000Z-aaaaaaaaaaaa-1.json",
            receiptSHA256: digest("8"),
            witnessPath:
              `/Users/yournameisai/.local/state/agenttool/deploy-state/phase-b-refence-maintenance-finalization-${fixture.evidence.runID}.json`,
            witnessSHA256: digest("9"),
          }),
          recoverToStoppedFence: async (_reason, context) => {
            expect(context).toEqual({
              providerEffectVerified: true,
              fleetMutationVerified: true,
            });
            recoveryCalls += 1;
            return digest("9");
          },
          retainManualBlocker: async () => {
            manualCalls += 1;
          },
          retainFinalizationManualBlocker: async () => {
            throw new Error("finalization manual lane must not run");
          },
        },
      })).rejects.toBeInstanceOf(ControllerSettledObservationError);
      expect(recoveryCalls).toBe(1);
      expect(manualCalls).toBe(0);
    }
  });

  test("a refused pre-effect guard retains the blocker without recovery effects", async () => {
    const fixture = guardFixture();
    let flyCalls = 0;
    let recoveryCalls = 0;
    let manualCalls = 0;
    await expect(runControllerRolloutCore({
      evidence: fixture.evidence,
      rolloutID: fixture.request.rolloutID,
      dependencies: {
        recordCheckpoint: async () => {},
        runSpecialGuard: async () => {
          throw new MaintenanceRefenceError("prepublication_guard_refused");
        },
        performFlyOperation: async () => {
          flyCalls += 1;
          return {
            proofSHA256: digest("1"),
            fleetSHA256: digest("2"),
          };
        },
        proveCordonedRuntime: async () => ({ proofSHA256: digest("3"), cleanupSHA256: digest("a") }),
        proveFirstCanaryPublic: async () => digest("4"),
        proveFinalAuthorityAndPublic: async () => ({
          publicProofSHA256: digest("5"),
          authorityProofSHA256: digest("6"),
          cleanupSHA256: digest("b"),
        }),
        runOrdinaryAbsentPostflight: async () => digest("7"),
        finalizeSuccess: async () => ({
          receiptPath:
            "/Users/yournameisai/.local/state/agenttool/deploy-receipts/20260825T120000Z-aaaaaaaaaaaa-1.json",
          receiptSHA256: digest("8"),
          witnessPath:
            `/Users/yournameisai/.local/state/agenttool/deploy-state/phase-b-refence-maintenance-finalization-${fixture.evidence.runID}.json`,
          witnessSHA256: digest("9"),
        }),
        recoverToStoppedFence: async () => {
          recoveryCalls += 1;
          return digest("9");
        },
        retainManualBlocker: async () => {
          manualCalls += 1;
        },
        retainFinalizationManualBlocker: async () => {
          throw new Error("finalization manual lane must not run");
        },
      },
    })).rejects.toBeInstanceOf(MaintenanceRefenceError);
    expect(flyCalls).toBe(0);
    expect(recoveryCalls).toBe(0);
    expect(manualCalls).toBe(1);
  });
});

describe("single-process controller recovery order", () => {
  const finalRuntimeExpectation = () => ({
    targetImageMachineIDs: [
      ...roles.app_lhr,
      roles.app_cdg,
      roles.thinker_primary,
      roles.thinker_standby,
    ],
    restartRestoredMachineIDs: [
      ...roles.app_lhr,
      roles.app_cdg,
      roles.thinker_primary,
      roles.thinker_standby,
    ],
    autostartEnabledAppMachineIDs: [...roles.app_lhr, roles.app_cdg],
    startedMachineIDs: [
      ...roles.app_lhr,
      roles.app_cdg,
      roles.thinker_primary,
    ],
    uncordonedAppMachineIDs: [...roles.app_lhr, roles.app_cdg],
  });

  test("recovery marker arrays bind verified cordon and refence transitions", () => {
    const value = {
      recovery_cordon_attempted_app_machine_ids: [] as string[],
      recovery_cordoned_app_machine_ids: [] as string[],
      recovery_refenced_machine_ids: [] as string[],
    };
    applyRecoveryMarkerTransitionForTest(
      value,
      { kind: "cordon", machineID: roles.app_lhr[0] },
      roles,
      true,
    );
    applyRecoveryMarkerTransitionForTest(
      value,
      { kind: "refence_standby", machineID: roles.thinker_standby },
      roles,
      true,
    );
    applyRecoveryMarkerTransitionForTest(
      value,
      { kind: "refence_primary", machineID: roles.thinker_primary },
      roles,
      false,
    );
    expect(value.recovery_cordon_attempted_app_machine_ids).toEqual([
      roles.app_lhr[0],
    ]);
    expect(value.recovery_cordoned_app_machine_ids).toEqual([
      roles.app_lhr[0],
    ]);
    expect(value.recovery_refenced_machine_ids).toEqual([
      roles.thinker_standby,
    ]);
    expect(() =>
      applyRecoveryMarkerTransitionForTest(
        value,
        { kind: "cordon", machineID: roles.thinker_primary },
        roles,
        true,
      )
    ).toThrow(MaintenanceRefenceError);
  });

  test("a build-only failure re-proves the stopped fence without mutating it", async () => {
    const fixture = guardFixture();
    const operations: ControllerFlyOperation[] = [];
    const checkpoints: string[] = [];
    let proofCalls = 0;
    const expectation = {
      targetImageMachineIDs: [],
      restartRestoredMachineIDs: [],
      autostartEnabledAppMachineIDs: [],
      startedMachineIDs: [],
      uncordonedAppMachineIDs: [],
    };
    const result = await runControllerRecoveryDispatchCoreForTest({
      evidence: fixture.evidence,
      reason: "prepublication_guard_refused",
      providerEffectVerified: true,
      fleetMutationVerified: false,
      image: null,
      initialFleetSHA256: digest("8"),
      initialExpectation: expectation,
      dependencies: {
        performFlyOperation: async (operation) => {
          operations.push(operation);
          throw new Error("build-only recovery must not mutate");
        },
        recordCheckpoint: async (checkpoint) => {
          checkpoints.push(checkpoint);
        },
        proveStoppedFence: async (observed, fleetSHA256) => {
          proofCalls += 1;
          expect(observed).toEqual(expectation);
          expect(fleetSHA256).toBe(digest("8"));
          return {
            proofSHA256: digest("3"),
            fleetSHA256,
          };
        },
      },
    });
    expect(operations).toEqual([]);
    expect(proofCalls).toBe(1);
    expect(checkpoints).toEqual(["recovery_fence_verified"]);
    expect(result.expectation).toEqual(expectation);
    expect(result.proofSHA256).toMatch(/^[0-9a-f]{64}$/);
  });

  test("a build-only recovery refuses any claimed target fleet mutation", async () => {
    const fixture = guardFixture();
    let proofCalls = 0;
    await expect(runControllerRecoveryDispatchCoreForTest({
      evidence: fixture.evidence,
      reason: "prepublication_guard_refused",
      providerEffectVerified: true,
      fleetMutationVerified: false,
      image: null,
      initialFleetSHA256: digest("8"),
      initialExpectation: {
        targetImageMachineIDs: [roles.thinker_primary],
        restartRestoredMachineIDs: [],
        autostartEnabledAppMachineIDs: [],
        startedMachineIDs: [],
        uncordonedAppMachineIDs: [],
      },
      dependencies: {
        performFlyOperation: async () => {
          throw new Error("must not run");
        },
        recordCheckpoint: async () => {},
        proveStoppedFence: async () => {
          proofCalls += 1;
          return {
            proofSHA256: digest("3"),
            fleetSHA256: digest("8"),
          };
        },
      },
    })).rejects.toThrow("controller_recovery_dispatch");
    expect(proofCalls).toBe(0);
  });

  test("closes app traffic before standby-first stopped-fence recovery", async () => {
    const fixture = guardFixture();
    const operations: string[] = [];
    const checkpoints: string[] = [];
    let terminalExpectation: unknown = null;
    const result = await runControllerRecoveryCoreForTest({
      evidence: fixture.evidence,
      reason: "final_public_refused",
      image: {
        tag: fixture.request.rolloutID,
        digest: "sha256:" + digest("a"),
        revision: fixture.request.targetRevision,
      },
      initialFleetSHA256: digest("8"),
      initialExpectation: finalRuntimeExpectation(),
      dependencies: {
        performFlyOperation: async (operation) => {
          operations.push(
            operation.kind + ":" +
              ("machineID" in operation ? operation.machineID : "agenttool"),
          );
          return {
            proofSHA256: digest("2"),
            fleetSHA256: digest("8"),
          };
        },
        recordCheckpoint: async (checkpoint) => {
          checkpoints.push(checkpoint);
        },
        proveStoppedFence: async (expectation) => {
          terminalExpectation = structuredClone(expectation);
          return {
            proofSHA256: digest("3"),
            fleetSHA256: digest("8"),
          };
        },
      },
    });
    expect(operations).toEqual([
      "cordon:" + roles.app_lhr[0],
      "cordon:" + roles.app_lhr[1],
      "cordon:" + roles.app_cdg,
      "refence_standby:" + roles.thinker_standby,
      "stop:" + roles.thinker_standby,
      "refence_primary:" + roles.thinker_primary,
      "stop:" + roles.thinker_primary,
      "refence_app:" + roles.app_lhr[0],
      "stop:" + roles.app_lhr[0],
      "refence_app:" + roles.app_lhr[1],
      "stop:" + roles.app_lhr[1],
      "refence_app:" + roles.app_cdg,
      "stop:" + roles.app_cdg,
    ]);
    expect(terminalExpectation).toEqual({
      targetImageMachineIDs: finalRuntimeExpectation().targetImageMachineIDs,
      restartRestoredMachineIDs: [],
      autostartEnabledAppMachineIDs: [],
      startedMachineIDs: [],
      uncordonedAppMachineIDs: [],
    });
    expect(
      checkpoints.filter((entry) => entry === "recovery_transition_verified"),
    ).toHaveLength(13);
    expect(checkpoints.at(-1)).toBe("recovery_fence_verified");
    expect(result.proofSHA256).toMatch(/^[0-9a-f]{64}$/);
  });

  test("an uncertain recovery child arms no later child or terminal proof", async () => {
    const fixture = guardFixture();
    const operations: string[] = [];
    let terminalProofCalls = 0;
    await expect(runControllerRecoveryCoreForTest({
      evidence: fixture.evidence,
      reason: "final_public_refused",
      image: {
        tag: fixture.request.rolloutID,
        digest: "sha256:" + digest("a"),
        revision: fixture.request.targetRevision,
      },
      initialFleetSHA256: digest("8"),
      initialExpectation: finalRuntimeExpectation(),
      dependencies: {
        performFlyOperation: async (operation) => {
          operations.push(
            operation.kind + ":" +
              ("machineID" in operation ? operation.machineID : "agenttool"),
          );
          if (operation.kind === "refence_standby") {
            throw new ControllerManualInterventionError(
              "provider_effect_failed_or_uncertain",
            );
          }
          return {
            proofSHA256: digest("2"),
            fleetSHA256: digest("8"),
          };
        },
        recordCheckpoint: async () => {},
        proveStoppedFence: async () => {
          terminalProofCalls += 1;
          return {
            proofSHA256: digest("3"),
            fleetSHA256: digest("8"),
          };
        },
      },
    })).rejects.toBeInstanceOf(ControllerManualInterventionError);
    expect(operations).toEqual([
      "cordon:" + roles.app_lhr[0],
      "cordon:" + roles.app_lhr[1],
      "cordon:" + roles.app_cdg,
      "refence_standby:" + roles.thinker_standby,
    ]);
    expect(terminalProofCalls).toBe(0);
  });
});

function successFlyEffectsFixture(): Array<{
  operation: string;
  target: string;
  proof_sha256: string;
}> {
  const applications = [...roles.app_lhr, roles.app_cdg];
  const effects: Array<[string, string]> = [
    ["build_push", "agenttool"],
    ["update_image", roles.thinker_primary],
    ...[...applications, roles.thinker_standby].map((id) =>
      [
        "update_image",
        id,
      ] as [string, string]
    ),
    ...applications.map((id) => ["restore_app", id] as [string, string]),
    ["restore_primary", roles.thinker_primary],
    ["restore_standby", roles.thinker_standby],
    ...applications.flatMap((id) => [
      ["start", id] as [string, string],
      ["wait_started", id] as [string, string],
    ]),
    ...applications.flatMap((id) => [
      ["enable_autostart", id] as [string, string],
      ["wait_started", id] as [string, string],
    ]),
    ["start", roles.thinker_primary],
    ["wait_started", roles.thinker_primary],
    ...applications.map((id) => ["uncordon", id] as [string, string]),
  ];
  return effects.map(([operation, target], index) => ({
    operation,
    target,
    proof_sha256: sha256(`success-effect-${index}`),
  }));
}

function successAuthorityRequestFixture(options: {
  successProvenAt?: string;
  lock?: {
    ownerPath: string;
    device: number;
    inode: number;
    sha256: string;
    pid: number;
  };
} = {}) {
  const controllerRunID = AUTHORIZED_H0_RUN_ID;
  const rolloutID =
    "maintenance-refence-d87a3f35c80b-20260825T120000Z-0123456789abcdef";
  const sourceRevision = AUTHORIZED_H0_TARGET_REVISION;
  const sourceTree = AUTHORIZED_H0_TARGET_TREE;
  const stateDirectory =
    "/Users/yournameisai/.local/state/agenttool/deploy-state";
  const stateRoot = "/Users/yournameisai/.local/state/agenttool";
  const buildRoot = `${stateRoot}/refence-maintenance-build-contexts`;
  const dependencyRoot = `${stateRoot}/refence-maintenance-dependency-estates`;
  const terminalEntrySHA256 = digest("1");
  const controllerWal = {
    directory:
      `${stateDirectory}/phase-b-refence-maintenance-bridge-wal/${controllerRunID}`,
    entry_count: 1,
    ordered_filenames: [`000001-${terminalEntrySHA256}.json`],
    chain_sha256: digest("2"),
    terminal_entry_sha256: terminalEntrySHA256,
    terminal_phase: "complete",
  };
  const lock = options.lock ?? {
    ownerPath:
      `${stateRoot}/.deploy-lock-owner.refence-${process.pid}-0123456789abcdef`,
    device: 42,
    inode: 526,
    sha256: digest("5"),
    pid: process.pid,
  };
  const databaseConvergence = {
    schema: "agenttool-phase-b-refence-database-origin-convergence/v1",
    status: "verified",
    intent_durable: true,
    statement_attempted: true,
    commit_state: "acknowledged",
    verified: true,
    reconciliation_required: false,
    database_write_attempt_count: 1,
    rows_updated: 1,
    rollback_attempt_count: 0,
    statement_sha256: databaseOriginStatementSHA256ForTest(),
    database_target_sha256: digest("3"),
    before_proof_sha256: digest("4"),
    after_proof_sha256: digest("5"),
    before_row_sha256: digest("6"),
    after_row_sha256: digest("7"),
    unchanged_projection_sha256: digest("8"),
    delta_sha256: digest("9"),
    before_instance_url_sha256: PRE_REFENCE_URL_SHA256,
    after_instance_url_sha256: TARGET_URL_SHA256,
    before_updated_at: PRE_REFENCE_UPDATED_AT,
    after_updated_at: CONVERGED_UPDATED_AT,
    clock_before: CONVERGENCE_CLOCK_BEFORE,
    clock_after: CONVERGENCE_CLOCK_AFTER,
    intent_wal_ordinal: 2,
    intent_wal_sha256: digest("a"),
    commit_ack_wal_ordinal: 3,
    commit_ack_wal_sha256: digest("b"),
    verified_wal_ordinal: 4,
    verified_wal_sha256: digest("c"),
  };
  const rolloutProofs = {
    special_guards: [digest("d"), digest("e")],
    fly_effects: successFlyEffectsFixture(),
    cordoned_runtime_sha256: digest("f"),
    cordoned_runtime_agent_cleanup_sha256: sha256("cordoned-agent-cleanup"),
    public_first_canary_sha256: digest("0"),
    public_final_sha256: digest("1"),
    final_authority_sha256: digest("2"),
    final_authority_agent_cleanup_sha256: sha256("final-agent-cleanup"),
    final_absence_sha256: sha256("final-agent-absence"),
    ordinary_absent_postflight_sha256: digest("3"),
  };
  const bindings = {
    rolloutID,
    receiptSHA256: AUTHORIZED_H0_RECEIPT_SHA256,
    runID: controllerRunID,
    targetRevision: sourceRevision,
    targetTree: sourceTree,
    anchorSHA256: digest("8"),
    anchorDevice: 42,
    anchorInode: 600,
    witnessSHA256: digest("9"),
    witnessDevice: 42,
    witnessInode: 601,
    producerGuardRawSHA256: AUTHORIZED_H0_GUARD_RAW_SHA256,
    producerGuardNormalizedSHA256: AUTHORIZED_H0_GUARD_NORMALIZED_SHA256,
    bridgeRawSHA256: digest("a"),
    bridgeNormalizedSHA256: digest("b"),
    controllerRevision: revision("e"),
    controllerTree: revision("f"),
    controllerSourceDistance: 54,
    controllerCommitRawSHA256: digest("c"),
    controllerCommitByteCount: 1_300,
    controllerTopicRevision: revision("1"),
    controllerTopicTree: revision("f"),
    changedPathsRawSHA256: sha256("current repair raw diff"),
    changedPathStatusesSHA256: sha256(
      canonicalJson(PROTECTED_SUCCESSOR_CHANGED_PATH_STATUSES),
    ),
    cumulativeChangedPathsRawSHA256: sha256("current cumulative raw diff"),
    cumulativeChangedPathStatusesSHA256: sha256(
      canonicalJson(PRIOR_PROTECTED_SUCCESSOR_CHANGED_PATH_STATUSES),
    ),
  };
  const preparation = {
    startedAt: "2026-08-25T12:00:00Z",
    deployLock: {
      schema: "agenttool-local-deploy-lock/v1" as const,
      public_path: `${stateRoot}/deploy.lock`,
      owner_record: lock.ownerPath,
      device: lock.device,
      inode: lock.inode,
      sha256: lock.sha256,
      pid: lock.pid,
    },
    buildContext: {
      schema: "agenttool-phase-b-refence-build-context/v1" as const,
      path: `${buildRoot}/${controllerRunID}`,
      source_revision: sourceRevision,
      source_tree: sourceTree,
      inventory_sha256:
        "ba1ee2dc3ede33e02460fd139273199db0d2c8e075976a28ff230543d46a7626",
      inventory_byte_count: 130_718,
      file_count: 707,
      byte_count: 10_102_535,
      context_device: 42,
      context_inode: 700,
      readback_sha256: digest("c"),
      ready_path: `${buildRoot}/${controllerRunID}.ready.json`,
      ready_sha256: digest("d"),
      prepared: true as const,
    },
    dependencyEstate: {
      schema: "agenttool-phase-b-refence-dependency-estate/v1" as const,
      path: `${dependencyRoot}/${controllerRunID}`,
      project_path: `${dependencyRoot}/${controllerRunID}/project`,
      runtime_source_path:
        "/Users/yournameisai/.bun/install/cache/postgres@3.4.9@@@1",
      source_revision: sourceRevision,
      source_tree: sourceTree,
      source_inventory_sha256: digest("e"),
      postgres_runtime_closure_sha256:
        "689e732c8ffc35e0c5c3aac2d6328c915abd56eec5b77a5790da2d3b7a154b71",
      dependency_inventory_sha256: digest("f"),
      dependency_file_count: 17,
      dependency_byte_count: 197_937,
      dependency_symlink_count: 0,
      estate_device: 42,
      estate_inode: 701,
      ready_path: `${dependencyRoot}/${controllerRunID}.ready.json`,
      ready_sha256: digest("0"),
      prepared: true as const,
    },
    controllerWalDirectory: controllerWal.directory,
    earlyGuardSHA256: digest("1"),
    earlyDatabaseProofSHA256: databaseConvergence.before_proof_sha256,
    databaseTargetSHA256: databaseConvergence.database_target_sha256,
  };
  const marker = createSuccessReadyBridgeMarkerForTest({
    bindings,
    roles,
    configFingerprint: digest("2"),
    preparation,
    updatedAt: "2026-08-25T12:29:59Z",
    imageDigest: `sha256:${"a".repeat(64)}`,
    databaseConvergence,
    controllerWal,
    rolloutProofs,
  });
  return {
    successProvenAt: options.successProvenAt ?? "2026-08-25T12:30:00Z",
    controllerRunID,
    rolloutID,
    refenceReceiptSHA256: AUTHORIZED_H0_RECEIPT_SHA256,
    sourceRevision,
    sourceTree,
    roles,
    marker,
    databaseConvergence,
    deployLock: structuredClone(preparation.deployLock),
    deployLockSHA256: lock.sha256,
    earlyGuardSHA256: preparation.earlyGuardSHA256,
    buildContext: structuredClone(marker.build_context),
    dependencyEstate: structuredClone(marker.dependency_estate),
    refenceHandoff: structuredClone(marker.refence_handoff),
    retainedArchives: {
      anchor: {
        path:
          `${stateDirectory}/phase-b-refence-observed-526-anchor-retired-${controllerRunID}.json`,
        sha256: bindings.anchorSHA256,
        device: 42,
        inode: 600,
        nlink: 1,
      },
      witness: {
        path:
          `${stateDirectory}/phase-b-refence-observed-526-armed-witness-retired-${controllerRunID}.json`,
        sha256: bindings.witnessSHA256,
        device: 42,
        inode: 601,
        nlink: 1,
      },
    },
    controllerWal,
    rolloutProofs,
    finalTruth: {
      schema: "agenttool-phase-b-refence-maintenance-final-truth/v1",
      database_convergence_verified: true,
      target_image_machine_count: 5,
      started_service_machine_count: 4,
      autostart_enabled_app_count: 3,
      uncordoned_app_count: 3,
      standby_stopped: true,
      authority_state: "absent_fail_closed",
      ordinary_absent_postflight_verified: true,
      controller_wal_sealed: true,
      active_child_count: 0,
      effects_closed: true,
      migration_attempt_count: 0,
      database_write_attempt_count: 1,
      rollback_attempt_count: 0,
      fly_ssh_agent_cleanup_count: 2,
      final_absence_sha256: rolloutProofs.final_absence_sha256,
    },
  };
}

function successArtifactRequestFixture(options: Parameters<
  typeof successAuthorityRequestFixture
>[0] = {}) {
  const authorityRequest = successAuthorityRequestFixture(options);
  const authority = createSuccessAuthorityProjectionForTest(authorityRequest);
  const stateRoot = "/Users/yournameisai/.local/state/agenttool";
  const stateDirectory = `${stateRoot}/deploy-state`;
  const receiptDirectory = `${stateRoot}/deploy-receipts`;
  const receiptPath = `${receiptDirectory}/20260825T120000Z-${
    authority.source_revision.slice(0, 12)
  }-1.json`;
  const witnessPath =
    `${stateDirectory}/phase-b-refence-maintenance-finalization-${authority.controller_run_id}.json`;
  const markerRetirementClaimPath =
    `${stateDirectory}/.phase-b-refence-maintenance-marker-retirement-${authority.controller_run_id}.claim`;
  const authorityProjectionSHA256 = sha256(canonicalJson(authority));
  const marker = previewSuccessFinalizationMarkerForTest({
    currentMarker: authorityRequest.marker,
    successProvenAt: authorityRequest.successProvenAt,
    walProjection: authorityRequest.controllerWal,
    authorityProjectionSHA256,
    receiptPath,
    witnessPath,
    markerRetirementClaimPath,
  });
  return {
    authorityRequest,
    authorityProjection: authority,
    markerPath: `${stateDirectory}/maintenance-active.json`,
    markerBytesUTF8: `${canonicalJson(marker)}\n`,
    receiptPath,
    witnessPath,
    markerRetirementClaimPath,
    lockPublicPath: `${stateRoot}/deploy.lock`,
    lockOwnerPath: authorityRequest.marker.deploy_lock.owner_record,
    lockDevice: String(authorityRequest.marker.deploy_lock.device),
    lockInode: String(authorityRequest.marker.deploy_lock.inode),
    lockSHA256: authority.deploy_lock_sha256,
  };
}

function resealForgedSuccessBundle(
  original: SuccessFinalizationArtifacts,
  mutateAuthority: (authority: Record<string, any>) => void,
): SuccessFinalizationArtifacts {
  const bundle = structuredClone(original);
  mutateAuthority(bundle.authorityProjection);
  bundle.authorityProjectionSHA256 = sha256(
    canonicalJson(bundle.authorityProjection),
  );
  const marker = JSON.parse(bundle.markerBytesUTF8);
  marker.success_finalization.authority_projection_sha256 =
    bundle.authorityProjectionSHA256;
  bundle.markerBytesUTF8 = `${canonicalJson(marker)}\n`;
  bundle.markerSHA256 = sha256(bundle.markerBytesUTF8);
  bundle.witness.authority_projection = structuredClone(
    bundle.authorityProjection,
  );
  bundle.witness.authority_projection_sha256 = bundle.authorityProjectionSHA256;
  bundle.witness.marker_bytes_utf8 = bundle.markerBytesUTF8;
  bundle.witness.marker_sha256 = bundle.markerSHA256;
  bundle.witnessBytesUTF8 = `${canonicalJson(bundle.witness)}\n`;
  bundle.witnessSHA256 = sha256(bundle.witnessBytesUTF8);
  bundle.receipt.authority_projection = structuredClone(
    bundle.authorityProjection,
  );
  bundle.receipt.authority_projection_sha256 = bundle.authorityProjectionSHA256;
  bundle.receipt.marker_bytes_utf8 = bundle.markerBytesUTF8;
  bundle.receipt.marker_sha256 = bundle.markerSHA256;
  bundle.receipt.witness_bytes_utf8 = bundle.witnessBytesUTF8;
  bundle.receipt.witness_sha256 = bundle.witnessSHA256;
  bundle.receiptBytesUTF8 = `${JSON.stringify(bundle.receipt, null, 2)}\n`;
  bundle.receiptSHA256 = sha256(bundle.receiptBytesUTF8);
  return bundle;
}

function resealSuccessBundleEnvelope(
  original: SuccessFinalizationArtifacts,
  mutate: (value: {
    marker: Record<string, any>;
    witness: Record<string, any>;
    receipt: Record<string, any>;
  }) => void,
): SuccessFinalizationArtifacts {
  const bundle = structuredClone(original);
  const marker = JSON.parse(bundle.markerBytesUTF8);
  mutate({ marker, witness: bundle.witness, receipt: bundle.receipt });
  bundle.markerBytesUTF8 = `${canonicalJson(marker)}\n`;
  bundle.markerSHA256 = sha256(bundle.markerBytesUTF8);
  bundle.witness.marker_bytes_utf8 = bundle.markerBytesUTF8;
  bundle.witness.marker_sha256 = bundle.markerSHA256;
  bundle.witnessBytesUTF8 = `${canonicalJson(bundle.witness)}\n`;
  bundle.witnessSHA256 = sha256(bundle.witnessBytesUTF8);
  bundle.receipt.marker_bytes_utf8 = bundle.markerBytesUTF8;
  bundle.receipt.marker_sha256 = bundle.markerSHA256;
  bundle.receipt.witness_bytes_utf8 = bundle.witnessBytesUTF8;
  bundle.receipt.witness_sha256 = bundle.witnessSHA256;
  bundle.receiptBytesUTF8 = `${JSON.stringify(bundle.receipt, null, 2)}\n`;
  bundle.receiptSHA256 = sha256(bundle.receiptBytesUTF8);
  return bundle;
}

function fsyncTestDirectory(path: string): void {
  const descriptor = openSync(path, fsConstants.O_RDONLY);
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function writeDurableTestFile(
  path: string,
  bytes: string,
): DurableFileIdentity {
  const descriptor = openSync(
    path,
    fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL |
      fsConstants.O_NOFOLLOW,
    0o600,
  );
  let identity: DurableFileIdentity;
  try {
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    const stat = fstatSync(descriptor);
    identity = {
      device: stat.dev,
      inode: stat.ino,
      sha256: sha256(bytes),
      size: stat.size,
    };
  } finally {
    closeSync(descriptor);
  }
  fsyncTestDirectory(dirname(path));
  return identity!;
}

interface FinalizationTestFixture {
  root: string;
  paths: SuccessFinalizationPaths;
  authorityPaths: SuccessFinalizationPaths;
  artifacts: SuccessFinalizationArtifacts;
  authorityRequest: ReturnType<typeof successAuthorityRequestFixture>;
  lock: DeployLockAuthority;
  preMarkerSHA256: string;
  markerCASStagePath: string;
  counts: { begin: number; pre: number; closed: number };
}

function finalizationTestFixture(): FinalizationTestFixture {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "refence-success-finalization-")),
  );
  temporaryDirectories.push(root);
  chmodSync(root, 0o700);
  chownSync(root, process.getuid?.() ?? 0, process.getgid?.() ?? 0);
  const stateDirectory = join(root, "deploy-state");
  const receiptDirectory = join(root, "deploy-receipts");
  mkdirSync(stateDirectory, { mode: 0o700 });
  mkdirSync(receiptDirectory, { mode: 0o700 });
  chownSync(stateDirectory, process.getuid?.() ?? 0, process.getgid?.() ?? 0);
  chownSync(receiptDirectory, process.getuid?.() ?? 0, process.getgid?.() ?? 0);
  fsyncTestDirectory(root);
  const canonicalRoot = "/Users/yournameisai/.local/state/agenttool";
  const canonicalStateDirectory = `${canonicalRoot}/deploy-state`;
  const canonicalReceiptDirectory = `${canonicalRoot}/deploy-receipts`;
  const canonicalWorktree =
    "/Users/yournameisai/.cache/codex-worktrees/agenttool-phase-b-refence-maintenance-bridge-v1";
  const canonicalOwnerPath =
    `${canonicalRoot}/.deploy-lock-owner.refence-${process.pid}-0123456789abcdef`;
  const lockOwnerPath = join(root, basename(canonicalOwnerPath));
  const publicLockPath = join(root, "deploy.lock");
  const lockRecordBytes = [
    "schema=agenttool-local-deploy-lock/v1",
    `owner_id=${basename(canonicalOwnerPath)}`,
    `pid=${process.pid}`,
    "started_at=2026-08-25T12:00:00Z",
    `worktree=${canonicalWorktree}`,
    `owner_record=${canonicalOwnerPath}`,
    "",
  ].join("\n");
  const lockIdentity = writeDurableTestFile(lockOwnerPath, lockRecordBytes);
  const lockDescriptor = openSync(
    lockOwnerPath,
    fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
  );
  linkSync(lockOwnerPath, publicLockPath);
  fsyncTestDirectory(root);
  const lock: DeployLockAuthority = {
    ownerPath: lockOwnerPath,
    recordBytes: lockRecordBytes,
    identity: lockIdentity,
    descriptor: lockDescriptor,
    phase: "held",
  };
  const artifactRequest = successArtifactRequestFixture({
    lock: {
      ownerPath: canonicalOwnerPath,
      device: lockIdentity.device,
      inode: lockIdentity.inode,
      sha256: lockIdentity.sha256,
      pid: process.pid,
    },
  });
  const artifacts = createSuccessArtifactsForTest(artifactRequest);
  validateSuccessArtifactBundleForTest(artifacts);
  const runID = artifactRequest.authorityRequest.controllerRunID;
  const authorityPaths: SuccessFinalizationPaths = {
    stateDirectory: canonicalStateDirectory,
    lockDirectory: canonicalRoot,
    receiptDirectory: canonicalReceiptDirectory,
    worktree: canonicalWorktree,
    markerPath: artifactRequest.markerPath,
    markerRetirementClaimPath: artifactRequest.markerRetirementClaimPath,
    receiptPath: artifactRequest.receiptPath,
    receiptStagePath:
      `${canonicalReceiptDirectory}/.phase-b-refence-maintenance-receipt-${runID}.stage`,
    witnessPath: artifactRequest.witnessPath,
    witnessStagePath:
      `${canonicalStateDirectory}/.phase-b-refence-maintenance-finalization-${runID}.stage`,
    publicLockPath: artifactRequest.lockPublicPath,
  };
  const paths: SuccessFinalizationPaths = {
    stateDirectory: realpathSync(stateDirectory),
    lockDirectory: root,
    receiptDirectory: realpathSync(receiptDirectory),
    worktree: root,
    markerPath: join(stateDirectory, basename(authorityPaths.markerPath)),
    markerRetirementClaimPath: join(
      stateDirectory,
      basename(authorityPaths.markerRetirementClaimPath),
    ),
    receiptPath: join(receiptDirectory, basename(authorityPaths.receiptPath)),
    receiptStagePath: join(
      receiptDirectory,
      basename(authorityPaths.receiptStagePath),
    ),
    witnessPath: join(stateDirectory, basename(authorityPaths.witnessPath)),
    witnessStagePath: join(
      stateDirectory,
      basename(authorityPaths.witnessStagePath),
    ),
    publicLockPath,
  };
  const preMarkerBytes = `${
    canonicalJson(artifactRequest.authorityRequest.marker)
  }\n`;
  const preMarkerIdentity = writeDurableTestFile(
    paths.markerPath,
    preMarkerBytes,
  );
  return {
    root,
    paths,
    authorityPaths,
    artifacts,
    authorityRequest: artifactRequest.authorityRequest,
    lock,
    preMarkerSHA256: preMarkerIdentity.sha256,
    markerCASStagePath: join(
      stateDirectory,
      `.maintenance-active-${runID}-success-finalization.stage`,
    ),
    counts: { begin: 0, pre: 0, closed: 0 },
  };
}

function runFinalizationFixture(
  fixture: FinalizationTestFixture,
  options: {
    crash?: (
      point: SuccessFinalizationCrashPoint,
      descriptors: readonly SuccessFinalizationOpenDescriptor[],
    ) => void;
    fsyncDirectory?: (
      path: string,
      descriptors: readonly SuccessFinalizationOpenDescriptor[],
    ) => void;
    afterBegin?: () => void;
    onA0Installed?: () => void;
  } = {},
) {
  return performSuccessFinalizationCeremony({
    paths: fixture.paths,
    authorityPaths: fixture.authorityPaths,
    lock: fixture.lock,
    artifacts: fixture.artifacts,
    beginMarkerFinalization: () => {
      fixture.counts.begin += 1;
      const nextValue = JSON.parse(fixture.artifacts.markerBytesUTF8);
      const result = replaceDurableCanonicalJsonCAS({
        canonicalPath: fixture.paths.markerPath,
        directory: fixture.paths.stateDirectory,
        stagePath: fixture.markerCASStagePath,
        expectedCurrentSHA256: fixture.preMarkerSHA256,
        nextValue,
        verifyAuthority: () => {
          const lockStat = fstatSync(fixture.lock.descriptor);
          expect(fixture.lock.phase).toBe("held");
          expect(lockStat.dev).toBe(fixture.lock.identity.device);
          expect(lockStat.ino).toBe(fixture.lock.identity.inode);
          expect(lockStat.nlink).toBe(2);
        },
        validateCurrent: (value) =>
          expect(canonicalJson(value)).toBe(
            canonicalJson(fixture.authorityRequest.marker),
          ),
        validateNext: (value) => {
          const expected = previewSuccessFinalizationMarkerForTest({
            currentMarker: fixture.authorityRequest.marker,
            successProvenAt: fixture.authorityRequest.successProvenAt,
            walProjection: fixture.authorityRequest.controllerWal,
            authorityProjectionSHA256:
              fixture.artifacts.authorityProjectionSHA256,
            receiptPath: fixture.authorityPaths.receiptPath,
            witnessPath: fixture.authorityPaths.witnessPath,
            markerRetirementClaimPath:
              fixture.authorityPaths.markerRetirementClaimPath,
          });
          expect(canonicalJson(value)).toBe(canonicalJson(expected));
          expect(`${canonicalJson(value)}\n`).toBe(
            fixture.artifacts.markerBytesUTF8,
          );
        },
        onDurableInstall: options.onA0Installed,
      });
      expect(result.sha256).toBe(fixture.artifacts.markerSHA256);
      options.afterBegin?.();
      return result.identity;
    },
    verifyPreFinalization: () => {
      fixture.counts.pre += 1;
    },
    verifyClosedLocalAuthority: () => {
      fixture.counts.closed += 1;
    },
    crash: options.crash,
    fsyncDirectory: options.fsyncDirectory,
  });
}

type FinalizationDirectoryRole = "state" | "receipt" | "lock";

interface FinalizationNamespaceRecord {
  directory: FinalizationDirectoryRole;
  alias: string;
  inodeKey: string;
  artifact: string;
  uid: number;
  gid: number;
  mode: number;
  size: number;
  reportedNlink: number;
}

interface FinalizationNamespaceGroup {
  artifact: string;
  aliases: string[];
  uid: number;
  gid: number;
  mode: number;
  size: number;
  nlink: number;
}

interface FinalizationOpenRecord {
  role: string;
  artifact: string;
  uid: number;
  gid: number;
  mode: number;
  size: number;
  nlink: number;
}

interface FinalizationSnapshot {
  visible: FinalizationNamespaceGroup[];
  durable: FinalizationNamespaceGroup[];
  open: FinalizationOpenRecord[];
  lockPhase: DeployLockAuthority["phase"];
}

function descriptorBytes(descriptor: number, size: number): Uint8Array {
  const bytes = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const count = readSync(descriptor, bytes, offset, size - offset, offset);
    if (count <= 0) throw new Error("finalization_snapshot_descriptor");
    offset += count;
  }
  return bytes;
}

class FinalizationSnapshotOracle {
  readonly fixture: FinalizationTestFixture;
  readonly durable = new Map<
    FinalizationDirectoryRole,
    FinalizationNamespaceRecord[]
  >();

  constructor(fixture: FinalizationTestFixture) {
    this.fixture = fixture;
    for (const role of ["state", "receipt", "lock"] as const) {
      this.commitRole(role);
    }
  }

  private directory(role: FinalizationDirectoryRole): string {
    return role === "state"
      ? this.fixture.paths.stateDirectory
      : role === "receipt"
      ? this.fixture.paths.receiptDirectory
      : this.fixture.paths.lockDirectory;
  }

  private directoryRole(path: string): FinalizationDirectoryRole {
    for (const role of ["state", "receipt", "lock"] as const) {
      if (path === this.directory(role)) return role;
    }
    throw new Error("finalization_snapshot_directory");
  }

  private artifact(hash: string): string {
    if (hash === this.fixture.artifacts.markerSHA256) return "marker";
    if (hash === this.fixture.preMarkerSHA256) return "pre_marker";
    if (hash === this.fixture.artifacts.receiptSHA256) return "receipt";
    if (hash === this.fixture.artifacts.witnessSHA256) return "witness";
    if (hash === this.fixture.lock.identity.sha256) return "lock";
    return `foreign:${hash}`;
  }

  private scanRole(
    role: FinalizationDirectoryRole,
  ): FinalizationNamespaceRecord[] {
    const directory = this.directory(role);
    const rows: FinalizationNamespaceRecord[] = [];
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      const stat = lstatSync(path);
      if (stat.isDirectory()) continue;
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error("finalization_snapshot_nonregular");
      }
      const hash = sha256(readFileSync(path));
      rows.push({
        directory: role,
        alias: `${role}/${name}`,
        inodeKey: `${stat.dev}:${stat.ino}`,
        artifact: this.artifact(hash),
        uid: stat.uid,
        gid: stat.gid,
        mode: stat.mode & 0o777,
        size: stat.size,
        reportedNlink: stat.nlink,
      });
    }
    return rows;
  }

  private visibleRecords(): FinalizationNamespaceRecord[] {
    return (["state", "receipt", "lock"] as const).flatMap((role) =>
      this.scanRole(role)
    );
  }

  private normalize(
    records: readonly FinalizationNamespaceRecord[],
    durable: boolean,
  ): FinalizationNamespaceGroup[] {
    const grouped = new Map<string, FinalizationNamespaceRecord[]>();
    for (const record of records) {
      const values = grouped.get(record.inodeKey) ?? [];
      values.push(record);
      grouped.set(record.inodeKey, values);
    }
    return [...grouped.values()].map((values) => {
      const first = values[0]!;
      expect(values.every((value) => value.artifact === first.artifact))
        .toBeTrue();
      expect(values.every((value) => value.uid === first.uid)).toBeTrue();
      expect(values.every((value) => value.gid === first.gid)).toBeTrue();
      expect(values.every((value) => value.mode === first.mode)).toBeTrue();
      expect(values.every((value) => value.size === first.size)).toBeTrue();
      const aliases = values.map((value) => value.alias).sort();
      const nlink = durable ? aliases.length : first.reportedNlink;
      if (!durable) {
        expect(values.every((value) => value.reportedNlink === nlink))
          .toBeTrue();
      }
      return {
        artifact: first.artifact,
        aliases,
        uid: first.uid,
        gid: first.gid,
        mode: first.mode,
        size: first.size,
        nlink,
      };
    }).sort((left, right) => {
      const a = canonicalJson(left);
      const b = canonicalJson(right);
      return a < b ? -1 : a > b ? 1 : 0;
    });
  }

  private openRecords(
    descriptors: readonly SuccessFinalizationOpenDescriptor[],
  ): FinalizationOpenRecord[] {
    return descriptors.map(({ role, descriptor }) => {
      const stat = fstatSync(descriptor);
      const hash = sha256(descriptorBytes(descriptor, stat.size));
      return {
        role,
        artifact: this.artifact(hash),
        uid: stat.uid,
        gid: stat.gid,
        mode: stat.mode & 0o777,
        size: stat.size,
        nlink: stat.nlink,
      };
    }).sort((left, right) => left.role < right.role ? -1 : 1);
  }

  commit(path: string): void {
    this.commitRole(this.directoryRole(path));
  }

  private commitRole(role: FinalizationDirectoryRole): void {
    this.durable.set(role, this.scanRole(role));
  }

  capture(
    descriptors: readonly SuccessFinalizationOpenDescriptor[],
  ): FinalizationSnapshot {
    const durableRecords = (["state", "receipt", "lock"] as const).flatMap(
      (role) => this.durable.get(role) ?? [],
    );
    return {
      visible: this.normalize(this.visibleRecords(), false),
      durable: this.normalize(durableRecords, true),
      open: this.openRecords(descriptors),
      lockPhase: this.fixture.lock.phase,
    };
  }
}

const FINALIZATION_CRASH_POINTS: readonly SuccessFinalizationCrashPoint[] = [
  "A0",
  "R1",
  "R2_linked_before_directory_fsync",
  "R3",
  "R4_unlinked_before_directory_fsync",
  "R5",
  "W1",
  "M1_linked_before_directory_fsync",
  "M1",
  "M2_unlinked_before_directory_fsync",
  "M2",
  "W2_linked_before_directory_fsync",
  "W2",
  "W3_unlinked_before_directory_fsync",
  "W3",
  "M3_unlinked_before_directory_fsync",
  "M3",
  "L1_unlinked_before_directory_fsync",
  "L1",
  "L2_unlinked_before_directory_fsync",
  "L2",
] as const;

function closeAbandonedFinalizationLock(
  fixture: FinalizationTestFixture,
): void {
  if (fixture.lock.phase !== "released") closeSync(fixture.lock.descriptor);
}

function finalizationBaselineTrace() {
  const fixture = finalizationTestFixture();
  const oracle = new FinalizationSnapshotOracle(fixture);
  const points: SuccessFinalizationCrashPoint[] = [];
  const pointSnapshots = new Map<
    SuccessFinalizationCrashPoint,
    FinalizationSnapshot
  >();
  const fsyncDirectories: FinalizationDirectoryRole[] = [];
  const fsyncBefore: FinalizationSnapshot[] = [];
  runFinalizationFixture(fixture, {
    afterBegin: () => oracle.commit(fixture.paths.stateDirectory),
    crash: (point, descriptors) => {
      points.push(point);
      pointSnapshots.set(point, oracle.capture(descriptors));
    },
    fsyncDirectory: (path, descriptors) => {
      fsyncBefore.push(oracle.capture(descriptors));
      fsyncDirectories.push(
        path === fixture.paths.receiptDirectory
          ? "receipt"
          : path === fixture.paths.stateDirectory
          ? "state"
          : path === fixture.paths.lockDirectory
          ? "lock"
          : (() => {
            throw new Error("finalization_snapshot_directory");
          })(),
      );
      fsyncTestDirectory(path);
      oracle.commit(path);
    },
  });
  return { fixture, points, pointSnapshots, fsyncDirectories, fsyncBefore };
}

describe("two-artifact success finalization", () => {
  test("pure authority and acyclic receipt/witness schemas are exact and deeply frozen", () => {
    const authorityRequest = successAuthorityRequestFixture();
    const authority = createSuccessAuthorityProjectionForTest(authorityRequest);
    expect(authority.retained_archives.witness.path).toContain(
      "-armed-witness-retired-",
    );
    expect(authority.controller_wal.terminal_phase).toBe("complete");
    expect(authority.rollout_proofs.fly_effects).toHaveLength(28);
    expect(Object.isFrozen(authority)).toBeTrue();
    expect(Object.isFrozen(authority.rollout_proofs.fly_effects)).toBeTrue();

    const artifactRequest = successArtifactRequestFixture();
    const bundle = createSuccessArtifactsForTest(artifactRequest);
    expect(bundle.witnessBytesUTF8).toBe(
      `${canonicalJson(bundle.witness)}\n`,
    );
    expect(bundle.receiptBytesUTF8).toBe(
      `${JSON.stringify(bundle.receipt, null, 2)}\n`,
    );
    expect(bundle.receipt.witness_bytes_utf8).toBe(bundle.witnessBytesUTF8);
    expect(bundle.receipt.witness_sha256).toBe(bundle.witnessSHA256);
    expect(bundle.witness).not.toHaveProperty("receipt_sha256");
    expect(bundle.witness).not.toHaveProperty("receipt_bytes_utf8");
    expect(bundle.receipt.lock_device).toBe("42");
    expect(bundle.receipt.lock_inode).toBe("526");
    expect(bundle.witness.lock_device).toBe("42");
    expect(bundle.witness.lock_inode).toBe("526");
    expect(bundle.receipt.truth).toEqual({
      marker_present_at_install: true,
      lock_held_at_install: true,
      marker_retirement_authorized: true,
      finalization_witness_required_before_lock_cleanup: true,
      marker_absence_claimed: false,
      lock_absence_claimed: false,
    });
    expect(bundle.witness.truth).toEqual({
      receipt_exact_and_durable: true,
      marker_canonical_absent_and_directory_fsynced: true,
      marker_retirement_claim_retained_at_install: true,
      same_original_lock_inode_held: true,
      lock_cleanup_authorized: true,
      lock_absence_claimed: false,
    });
    expect(Object.isFrozen(bundle)).toBeTrue();
    expect(Object.isFrozen(bundle.receipt.authority_projection)).toBeTrue();

    const badArchive = structuredClone(authorityRequest);
    badArchive.retainedArchives.witness.path = badArchive.retainedArchives
      .witness.path.replace(
        "armed-witness",
        "witness",
      );
    expectMaintenanceRefusalCode(
      () => createSuccessAuthorityProjectionForTest(badArchive),
      "success_authority_handoff",
    );
    const badEffect = structuredClone(authorityRequest);
    [
      badEffect.rolloutProofs.fly_effects[0],
      badEffect.rolloutProofs.fly_effects[1],
    ] = [
      badEffect.rolloutProofs.fly_effects[1],
      badEffect.rolloutProofs.fly_effects[0],
    ];
    expectMaintenanceRefusalCode(
      () => createSuccessAuthorityProjectionForTest(badEffect),
      "success_authority_rollout_proofs",
    );
    for (const lockDevice of ["", "01", "-1", "1.0", " 1", "+1"]) {
      const bad = structuredClone(artifactRequest);
      bad.lockDevice = lockDevice;
      expectMaintenanceRefusalCode(
        () => createSuccessArtifactsForTest(bad),
        "success_artifact_paths",
      );
    }
    const markerDrift = structuredClone(artifactRequest);
    const marker = JSON.parse(markerDrift.markerBytesUTF8);
    marker.success_receipt.durable = true;
    markerDrift.markerBytesUTF8 = `${canonicalJson(marker)}\n`;
    expectMaintenanceRefusalCode(
      () => createSuccessArtifactsForTest(markerDrift),
      "success_artifact_marker",
    );
  });

  test("durable handoff v4 keeps H0, failed e4/56dc, and current controller disjoint", () => {
    const positive = successAuthorityRequestFixture();
    const handoff = positive.refenceHandoff as any;
    const authorizedH0 = handoff.authorized_h0;
    const prior = handoff.prior_failed_compatibility_controller;
    const immediate = handoff.immediate_failed_compatibility_controller;
    const controller = handoff.compatibility_controller;
    const contract = containedContractBytes();
    expect(handoff.proof_schema).toBe(
      "agenttool-phase-b-refence-handoff/v4",
    );
    expect(authorizedH0.lifecycle).toBe("historical");
    expect(authorizedH0.receipt_sha256).toBe(
      AUTHORIZED_H0_RECEIPT_SHA256,
    );
    expect(authorizedH0.target_revision).toBe(
      AUTHORIZED_H0_TARGET_REVISION,
    );
    expect(prior.lifecycle).toBe("failed_pre_h");
    expect(prior.controller_revision).toBe(
      PRIOR_FAILED_COMPATIBILITY_REVISION,
    );
    expect(prior.controller_tree).toBe(PRIOR_FAILED_COMPATIBILITY_TREE);
    expect(prior.first_parent_revision).toBe(AUTHORIZED_H0_TARGET_REVISION);
    expect(prior.second_parent_revision).toBe(
      PRIOR_FAILED_COMPATIBILITY_TOPIC_REVISION,
    );
    expect(prior.second_parent_tree).toBe(prior.controller_tree);
    expect(prior.commit_raw_sha256).toBe(
      PRIOR_FAILED_COMPATIBILITY_COMMIT_RAW_SHA256,
    );
    expect(prior.static_refusal_barrier_verified).toBeTrue();
    expect(prior.observed_first_refusal_predicate).toBeFalse();
    expect(prior.controller_success).toBeFalse();
    expect(prior.mutation_effect_began).toBeFalse();
    expect(prior.success_authority).toBeFalse();
    expect(prior.effect_authority).toBeFalse();
    expect(prior.changed_path_statuses).toEqual(
      PRIOR_PROTECTED_SUCCESSOR_CHANGED_PATH_STATUSES,
    );
    expect(prior.changed_path_statuses_sha256).toBe(
      "211620ae73940844daa44dad70dec9026d4f9759ea9abda4706abdc41ef81698",
    );
    expect(prior.changed_paths_raw_sha256).toBe(
      "a66803eadc08fb8deb23fe3076deeadfc5310c1c6b5aeb50f5edc284511aaf28",
    );
    expect(immediate.lifecycle).toBe("failed_pre_h");
    expect(immediate.controller_revision).toBe(
      IMMEDIATE_FAILED_COMPATIBILITY_REVISION,
    );
    expect(immediate.first_parent_revision).toBe(
      PRIOR_FAILED_COMPATIBILITY_REVISION,
    );
    expect(immediate.refusal_predicate).toBe("process_census");
    expect(immediate.controller_exit_code).toBe(74);
    expect(immediate.stderr_sha256).toBe(
      "60298dba6e24230d90d2f8ae15f3319f284b498cd3f14dbdbbedb8f1689322d8",
    );
    expect(immediate.retained_deploy_lock_sha256).toBe(
      "63b41175b9b17ddb000c815a477ca357ee923d9c18eabec7b339ba3f5f1288cf",
    );
    expect(immediate.changed_paths_raw_sha256).toBe(
      "ea34fd5818a88c0554303040c9472d7b3699db15bbae5344c4b1e670577bc6f8",
    );
    expect(immediate.cumulative_changed_paths_raw_sha256).toBe(
      "8d83631671ddfab6bc122d5b571df49ab0907c2e40ac1353f2663ccae407d7c2",
    );
    expect(Object.values(immediate.downstream_effects)).toEqual(
      Array(10).fill(0),
    );
    expect(immediate.success_authority).toBeFalse();
    expect(immediate.effect_authority).toBeFalse();
    expect(controller.lifecycle).toBe("current");
    expect(controller.predecessor_controller_revision).toBe(
      IMMEDIATE_FAILED_COMPATIBILITY_REVISION,
    );
    expect(controller.first_parent_revision).toBe(
      IMMEDIATE_FAILED_COMPATIBILITY_REVISION,
    );
    expect(controller.second_parent_tree).toBe(controller.controller_tree);
    expect(controller.bridge_source_sha256).toBe(
      handoff.bridge_source_sha256,
    );
    expect(controller.bridge_normalized_sha256).toBe(
      handoff.bridge_normalized_sha256,
    );
    expect(controller.bridge_source_sha256).not.toBe(
      authorizedH0.guard_raw_sha256,
    );
    expect(controller.bridge_normalized_sha256).not.toBe(
      authorizedH0.guard_normalized_sha256,
    );
    expect(controller.bridge_source_sha256).not.toBe(
      prior.bridge_source_sha256,
    );
    expect(controller.bridge_normalized_sha256).not.toBe(
      prior.bridge_normalized_sha256,
    );
    expect(controller.bridge_source_sha256).not.toBe(
      immediate.bridge_source_sha256,
    );
    expect(controller.contract_source_sha256).toBe(contract.sha256);
    expect(controller.contract_git_blob).toBe(contract.gitBlobSHA1);
    expect(controller.contract_source_sha256).not.toBe(
      authorizedH0.contract_raw_sha256,
    );
    expect(controller.contract_source_sha256).not.toBe(
      prior.contract_source_sha256,
    );
    expect(controller.contract_source_sha256).not.toBe(
      immediate.contract_source_sha256,
    );
    expect(controller.repair_changed_paths_raw_sha256).not.toBe(
      immediate.changed_paths_raw_sha256,
    );
    expect(controller.repair_changed_path_statuses).toEqual(
      PROTECTED_SUCCESSOR_CHANGED_PATH_STATUSES,
    );
    expect(controller.repair_changed_path_statuses_sha256).toBe(
      "f0a1b1436517bd4179410889a12def8fc447b9dc1772001196b5d0a6c05ad88e",
    );
    expect(controller.cumulative_changed_path_statuses).toEqual(
      PRIOR_PROTECTED_SUCCESSOR_CHANGED_PATH_STATUSES,
    );
    expect(controller.cumulative_changed_path_statuses_sha256).toBe(
      "211620ae73940844daa44dad70dec9026d4f9759ea9abda4706abdc41ef81698",
    );
    expect(controller.cumulative_changed_paths_raw_sha256).not.toBe(
      immediate.cumulative_changed_paths_raw_sha256,
    );
    expect(controller.payload_revision).toBe(AUTHORIZED_H0_TARGET_REVISION);
    expect(controller.payload_tree).toBe(AUTHORIZED_H0_TARGET_TREE);
    expect(controller.payload_distance).toBe(47);
    expect(() => createSuccessAuthorityProjectionForTest(positive)).not
      .toThrow();

    const mutations: Array<[
      string,
      (value: any) => void,
    ]> = [
      [
        "historical lifecycle",
        (value) => value.authorized_h0.lifecycle = "current",
      ],
      [
        "historical guard raw",
        (value) => value.authorized_h0.guard_raw_sha256 = digest("7"),
      ],
      [
        "historical guard normalized",
        (value) => value.authorized_h0.guard_normalized_sha256 = digest("7"),
      ],
      [
        "historical contract raw",
        (value) => value.authorized_h0.contract_raw_sha256 = digest("7"),
      ],
      [
        "historical contract blob",
        (value) => value.authorized_h0.contract_git_blob = revision("7"),
      ],
      [
        "prior lifecycle",
        (value) => value.prior_failed_compatibility_controller.lifecycle = "current",
      ],
      [
        "prior revision",
        (value) => value.prior_failed_compatibility_controller.controller_revision = revision("7"),
      ],
      [
        "prior commit",
        (value) => value.prior_failed_compatibility_controller.commit_raw_sha256 = digest("7"),
      ],
      [
        "prior topic tree",
        (value) => value.prior_failed_compatibility_controller.second_parent_tree = revision("7"),
      ],
      [
        "prior success authority",
        (value) => value.prior_failed_compatibility_controller.success_authority = true,
      ],
      [
        "prior effect authority",
        (value) => value.prior_failed_compatibility_controller.effect_authority = true,
      ],
      [
        "prior first-predicate claim",
        (value) => value.prior_failed_compatibility_controller.observed_first_refusal_predicate = true,
      ],
      [
        "prior changed projection",
        (value) => value.prior_failed_compatibility_controller.changed_path_statuses.pop(),
      ],
      [
        "immediate cumulative raw closure",
        (value) =>
          value.immediate_failed_compatibility_controller
            .cumulative_changed_paths_raw_sha256 = digest("7"),
      ],
      [
        "immediate refusal",
        (value) =>
          value.immediate_failed_compatibility_controller.controller_exit_code = 0,
      ],
      [
        "immediate downstream effect",
        (value) =>
          value.immediate_failed_compatibility_controller.downstream_effects
            .provider_effect_count = 1,
      ],
      [
        "controller revision",
        (value) =>
          value.compatibility_controller.controller_revision =
            AUTHORIZED_H0_TARGET_REVISION,
      ],
      [
        "controller tree",
        (value) =>
          value.compatibility_controller.controller_tree =
            AUTHORIZED_H0_TARGET_TREE,
      ],
      [
        "controller first parent",
        (value) =>
          value.compatibility_controller.first_parent_revision = revision("7"),
      ],
      [
        "controller topic tree",
        (value) =>
          value.compatibility_controller.second_parent_tree = revision("7"),
      ],
      [
        "controller source distance",
        (value) => value.compatibility_controller.controller_source_distance = 51,
      ],
      [
        "controller commit grammar",
        (value) => value.compatibility_controller.commit_raw_sha256 = "invalid",
      ],
      [
        "controller second parent",
        (value) =>
          value.compatibility_controller.second_parent_revision =
            value.compatibility_controller.controller_revision,
      ],
      [
        "controller bridge raw",
        (value) => {
          value.bridge_source_sha256 = AUTHORIZED_H0_GUARD_RAW_SHA256;
          value.compatibility_controller.bridge_source_sha256 =
            AUTHORIZED_H0_GUARD_RAW_SHA256;
        },
      ],
      [
        "controller bridge normalized",
        (value) => {
          value.bridge_normalized_sha256 =
            AUTHORIZED_H0_GUARD_NORMALIZED_SHA256;
          value.compatibility_controller.bridge_normalized_sha256 =
            AUTHORIZED_H0_GUARD_NORMALIZED_SHA256;
        },
      ],
      [
        "controller contract raw",
        (value) =>
          value.compatibility_controller.contract_source_sha256 =
            AUTHORIZED_H0_CONTRACT_RAW_SHA256,
      ],
      [
        "controller contract blob",
        (value) =>
          value.compatibility_controller.contract_git_blob =
            AUTHORIZED_H0_CONTRACT_GIT_BLOB,
      ],
      [
        "payload revision",
        (value) =>
          value.compatibility_controller.payload_revision = revision("7"),
      ],
      [
        "payload tree",
        (value) => value.compatibility_controller.payload_tree = revision("7"),
      ],
      [
        "payload distance",
        (value) => value.compatibility_controller.payload_distance = 48,
      ],
      [
        "repair path projection",
        (value) => {
          value.compatibility_controller.repair_changed_path_statuses[0].new_mode =
            "100644";
          value.compatibility_controller.repair_changed_path_statuses_sha256 = sha256(
            canonicalJson(
              value.compatibility_controller.repair_changed_path_statuses,
            ),
          );
        },
      ],
      [
        "repair raw closure aliases immediate",
        (value) =>
          value.compatibility_controller.repair_changed_paths_raw_sha256 =
            value.immediate_failed_compatibility_controller
              .changed_paths_raw_sha256,
      ],
      [
        "cumulative path projection",
        (value) => value.compatibility_controller.cumulative_changed_path_statuses.pop(),
      ],
      [
        "cumulative raw closure aliases 56dc",
        (value) =>
          value.compatibility_controller.cumulative_changed_paths_raw_sha256 =
            value.immediate_failed_compatibility_controller
              .cumulative_changed_paths_raw_sha256,
      ],
    ];
    for (const [name, mutate] of mutations) {
      const request = structuredClone(successAuthorityRequestFixture());
      mutate(request.refenceHandoff);
      request.marker.refence_handoff = structuredClone(
        request.refenceHandoff,
      );
      expectMaintenanceRefusalCode(
        () => createSuccessAuthorityProjectionForTest(request),
        "success_authority_handoff",
      );
    }
    for (const mutate of [
      (value: any) => delete value.prior_failed_compatibility_controller,
      (value: any) => delete value.immediate_failed_compatibility_controller,
      (value: any) => value.extra = false,
      (value: any) =>
        delete value.prior_failed_compatibility_controller.success_authority,
      (value: any) =>
        value.prior_failed_compatibility_controller.extra = false,
      (value: any) =>
        value.immediate_failed_compatibility_controller.extra = false,
      (value: any) => delete value.compatibility_controller.commit_byte_count,
      (value: any) => value.compatibility_controller.extra = false,
    ]) {
      const request = structuredClone(successAuthorityRequestFixture());
      mutate(request.refenceHandoff);
      expectMaintenanceRefusalCode(
        () => createSuccessAuthorityProjectionForTest(request),
        "success_authority_handoff",
      );
    }
  });

  test("full marker authority and the artifact DAG reject every independent domain drift", () => {
    const mutations: Array<[
      string,
      (request: ReturnType<typeof successAuthorityRequestFixture>) => void,
    ]> = [
      [
        "marker child WAL",
        (value) => value.marker.child_wal.chain_sha256 = digest("7"),
      ],
      [
        "marker database",
        (value) =>
          value.marker.database_convergence.after_proof_sha256 = digest("7"),
      ],
      [
        "marker build",
        (value) => value.marker.build_context.ready_sha256 = digest("7"),
      ],
      [
        "marker dependencies",
        (value) => value.marker.dependency_estate.ready_sha256 = digest("7"),
      ],
      [
        "marker handoff",
        (value) => value.marker.refence_handoff.anchor_sha256 = digest("7"),
      ],
      [
        "marker guard",
        (value) => value.marker.guard_proofs.final_sha256 = digest("7"),
      ],
      [
        "marker early guard",
        (value) => value.marker.guard_proofs.early_sha256 = digest("7"),
      ],
      [
        "marker public",
        (value) => value.marker.public_proofs.final_sha256 = digest("7"),
      ],
      ["marker progress", (value) => value.marker.attempted_machine_ids.pop()],
      ["marker lock", (value) => value.marker.deploy_lock.sha256 = digest("7")],
      ["request roles", (value) => value.roles.app_lhr.reverse()],
      ["request source", (value) => value.sourceRevision = revision("7")],
      [
        "request run",
        (value) =>
          value.controllerRunID = "11234567-89ab-cdef-0123-456789abcdef",
      ],
      [
        "request WAL",
        (value) => value.controllerWal.chain_sha256 = digest("7"),
      ],
      [
        "request database",
        (value) => value.databaseConvergence.after_row_sha256 = digest("0"),
      ],
      [
        "request build",
        (value) => value.buildContext.readback_sha256 = digest("7"),
      ],
      [
        "request dependencies",
        (value) =>
          value.dependencyEstate.dependency_inventory_sha256 = digest("7"),
      ],
      [
        "request handoff",
        (value) => value.refenceHandoff.witness_sha256 = digest("7"),
      ],
      [
        "request early guard",
        (value) => value.earlyGuardSHA256 = digest("7"),
      ],
      ["request lock", (value) => value.deployLockSHA256 = digest("7")],
      [
        "request lock owner",
        (value) =>
          value.deployLock.owner_record = value.deployLock.owner_record.replace(
            "0123456789abcdef",
            "1123456789abcdef",
          ),
      ],
      [
        "request lock device",
        (value) => value.deployLock.device += 1,
      ],
      [
        "request lock inode",
        (value) => value.deployLock.inode += 1,
      ],
      [
        "request anchor device",
        (value) => value.retainedArchives.anchor.device += 1,
      ],
      [
        "request anchor inode",
        (value) => value.retainedArchives.anchor.inode += 1,
      ],
      [
        "request witness device",
        (value) => value.retainedArchives.witness.device += 1,
      ],
      [
        "request witness inode",
        (value) => value.retainedArchives.witness.inode += 1,
      ],
      ["final truth", (value) => value.finalTruth.effects_closed = false],
      [
        "final absence rollout proof",
        (value) => value.rolloutProofs.final_absence_sha256 = digest("7"),
      ],
      [
        "final absence truth",
        (value) => value.finalTruth.final_absence_sha256 = digest("7"),
      ],
    ];
    for (const [name, mutate] of mutations) {
      const request = structuredClone(successAuthorityRequestFixture());
      mutate(request);
      expect(
        () => createSuccessAuthorityProjectionForTest(request),
        name,
      ).toThrow(MaintenanceRefenceError);
    }

    const artifactRequest = successArtifactRequestFixture();
    const authorityDrift = structuredClone(artifactRequest);
    authorityDrift.authorityProjection.final_truth.effects_closed = false;
    expect(() => createSuccessArtifactsForTest(authorityDrift)).toThrow(
      MaintenanceRefenceError,
    );
    const bundle = createSuccessArtifactsForTest(artifactRequest);
    const forged = resealForgedSuccessBundle(bundle, (authority) => {
      authority.final_truth.effects_closed = false;
    });
    expect(() => validateSuccessArtifactBundleForTest(forged)).toThrow(
      MaintenanceRefenceError,
    );
    for (
      const [name, mutate] of [
        [
          "retained archive device",
          (authority: Record<string, any>) =>
            authority.retained_archives.anchor.device += 1,
        ],
        [
          "retained archive inode",
          (authority: Record<string, any>) =>
            authority.retained_archives.witness.inode += 1,
        ],
        [
          "refence receipt SHA",
          (authority: Record<string, any>) =>
            authority.refence_receipt_sha256 = digest("7"),
        ],
      ] as const
    ) {
      const bad = resealForgedSuccessBundle(bundle, mutate);
      expect(() => validateSuccessArtifactBundleForTest(bad), name).toThrow(
        MaintenanceRefenceError,
      );
    }
    for (
      const [name, mutate] of [
        [
          "A0 authority digest",
          (value: any) =>
            value.marker.success_finalization.authority_projection_sha256 =
              digest("7"),
        ],
        [
          "A0 receipt pending",
          (value: any) =>
            value.marker.success_finalization.receipt_pending = false,
        ],
        [
          "A0 retirement authorization",
          (value: any) =>
            value.marker.success_finalization.marker_retirement_authorized =
              false,
        ],
        [
          "witness run",
          (value: any) =>
            value.witness.run_id = "11234567-89ab-cdef-0123-456789abcdef",
        ],
        [
          "receipt source",
          (value: any) => value.receipt.source_revision = revision("7"),
        ],
        [
          "receipt tree",
          (value: any) => value.receipt.source_tree = revision("7"),
        ],
        [
          "receipt time",
          (value: any) =>
            value.receipt.success_proven_at = "2026-08-25T12:30:01Z",
        ],
        [
          "receipt basename",
          (value: any) => {
            const path = value.witness.receipt_path.replace(
              /[^/]+$/,
              "wrong.json",
            );
            value.witness.receipt_path = path;
            value.marker.success_receipt.path = path;
          },
        ],
      ] as const
    ) {
      const bad = resealSuccessBundleEnvelope(bundle, mutate);
      expect(() => validateSuccessArtifactBundleForTest(bad), name).toThrow(
        MaintenanceRefenceError,
      );
    }
    for (
      const key of [
        "authorityProjectionSHA256",
        "markerSHA256",
        "witnessSHA256",
        "receiptSHA256",
      ] as const
    ) {
      const bad = structuredClone(bundle);
      bad[key] = digest("7");
      expect(() => validateSuccessArtifactBundleForTest(bad), key).toThrow(
        MaintenanceRefenceError,
      );
    }
    const swapped = structuredClone(bundle);
    swapped.witnessBytesUTF8 = bundle.markerBytesUTF8;
    swapped.witnessSHA256 = bundle.markerSHA256;
    expect(() => validateSuccessArtifactBundleForTest(swapped)).toThrow(
      MaintenanceRefenceError,
    );
  });

  test("success ceremony reaches R5/W3/M3/L2 with exact final artifacts", () => {
    const fixture = finalizationTestFixture();
    expect(lstatSync(fixture.paths.lockDirectory).mode & 0o777).toBe(0o700);
    expect(realpathSync(fixture.paths.lockDirectory)).toBe(
      fixture.paths.lockDirectory,
    );
    expect(lstatSync(fixture.paths.lockDirectory).uid).toBe(process.getuid?.());
    expect(lstatSync(fixture.paths.lockDirectory).gid).toBe(process.getgid?.());
    expect(lstatSync(fixture.paths.lockDirectory).isDirectory()).toBeTrue();
    expect(lstatSync(fixture.paths.lockDirectory).isSymbolicLink()).toBeFalse();
    const result = runFinalizationFixture(fixture);
    expect(result).toEqual({
      receiptPath: fixture.paths.receiptPath,
      receiptSHA256: fixture.artifacts.receiptSHA256,
      witnessPath: fixture.paths.witnessPath,
      witnessSHA256: fixture.artifacts.witnessSHA256,
    });
    expect(existsSync(fixture.paths.markerPath)).toBeFalse();
    expect(existsSync(fixture.paths.markerRetirementClaimPath)).toBeFalse();
    expect(existsSync(fixture.paths.receiptStagePath)).toBeFalse();
    expect(existsSync(fixture.paths.witnessStagePath)).toBeFalse();
    expect(existsSync(fixture.paths.publicLockPath)).toBeFalse();
    expect(existsSync(fixture.lock.ownerPath)).toBeFalse();
    expect(readFileSync(fixture.paths.receiptPath, "utf8")).toBe(
      fixture.artifacts.receiptBytesUTF8,
    );
    expect(readFileSync(fixture.paths.witnessPath, "utf8")).toBe(
      fixture.artifacts.witnessBytesUTF8,
    );
    expect(fixture.lock.phase).toBe("released");
    expect(() => fstatSync(fixture.lock.descriptor)).toThrow();
    expect(fixture.counts).toEqual({ begin: 1, pre: 1, closed: 1 });
  });

  test("every crash cut matches the no-fault fsync ledger without namespace repair", () => {
    const baseline = finalizationBaselineTrace();
    expect(baseline.points).toEqual(FINALIZATION_CRASH_POINTS);
    expect(baseline.fsyncDirectories).toEqual([
      "receipt",
      "receipt",
      "state",
      "state",
      "state",
      "state",
      "state",
      "lock",
      "lock",
    ]);
    for (const snapshot of baseline.pointSnapshots.values()) {
      for (const entry of [...snapshot.visible, ...snapshot.durable]) {
        expect(entry.uid).toBe(process.getuid?.());
        expect(entry.gid).toBe(process.getgid?.());
        expect(entry.mode).toBe(0o600);
        expect(entry.nlink).toBe(entry.aliases.length);
      }
      for (const entry of snapshot.open) {
        expect(entry.uid).toBe(process.getuid?.());
        expect(entry.gid).toBe(process.getgid?.());
        expect(entry.mode).toBe(0o600);
        expect(entry.role).toBe(entry.artifact);
      }
    }
    expect(baseline.pointSnapshots.get("M3")?.open).toContainEqual(
      expect.objectContaining({ role: "marker", artifact: "marker", nlink: 0 }),
    );
    expect(
      baseline.pointSnapshots.get("A0")?.open.map(({ role, nlink }) => ({
        role,
        nlink,
      })),
    ).toEqual([
      { role: "lock", nlink: 2 },
      { role: "marker", nlink: 1 },
    ]);
    expect(
      baseline.pointSnapshots.get("R1")?.open.map(({ role, nlink }) => ({
        role,
        nlink,
      })),
    ).toEqual([
      { role: "lock", nlink: 2 },
      { role: "marker", nlink: 1 },
      { role: "receipt", nlink: 1 },
    ]);
    expect(
      baseline.pointSnapshots.get("W1")?.open.map(({ role, nlink }) => ({
        role,
        nlink,
      })),
    ).toEqual([
      { role: "lock", nlink: 2 },
      { role: "marker", nlink: 1 },
      { role: "witness", nlink: 1 },
    ]);
    expect(
      baseline.pointSnapshots.get("L2_unlinked_before_directory_fsync")?.open,
    ).toContainEqual(
      expect.objectContaining({ role: "lock", artifact: "lock", nlink: 0 }),
    );
    expect(baseline.pointSnapshots.get("L2")?.open).toEqual([]);

    for (const point of FINALIZATION_CRASH_POINTS) {
      const fixture = finalizationTestFixture();
      const oracle = new FinalizationSnapshotOracle(fixture);
      let reached = false;
      let captured: FinalizationSnapshot | null = null;
      const observed: SuccessFinalizationCrashPoint[] = [];
      const fsyncs: string[] = [];
      expect(() =>
        runFinalizationFixture(fixture, {
          afterBegin: () => oracle.commit(fixture.paths.stateDirectory),
          fsyncDirectory: (path) => {
            fsyncs.push(path);
            fsyncTestDirectory(path);
            oracle.commit(path);
          },
          crash: (observedPoint, descriptors) => {
            observed.push(observedPoint);
            if (observedPoint !== point) return;
            reached = true;
            captured = oracle.capture(descriptors);
            throw new Error(`injected_${point}`);
          },
        })
      ).toThrow(`injected_${point}`);
      expect(reached).toBeTrue();
      expect(observed).toEqual(
        FINALIZATION_CRASH_POINTS.slice(
          0,
          FINALIZATION_CRASH_POINTS.indexOf(point) + 1,
        ),
      );
      expect(captured).toEqual(baseline.pointSnapshots.get(point));
      const remainingDescriptors = fixture.lock.phase === "released"
        ? []
        : [{ role: "lock" as const, descriptor: fixture.lock.descriptor }];
      const afterThrow = oracle.capture(remainingDescriptors);
      expect(afterThrow.visible).toEqual(captured!.visible);
      expect(afterThrow.durable).toEqual(captured!.durable);
      expect(fsyncs.length).toBeLessThanOrEqual(9);
      expect(fixture.lock.phase).toBe(captured!.lockPhase);
      expect(fixture.counts.begin).toBe(1);
      expect(fixture.counts.pre).toBe(1);
      expect(fixture.counts.closed).toBe(
        point.startsWith("L") ? 1 : 0,
      );
      if (point === "L2") {
        expect(() => fstatSync(fixture.lock.descriptor)).toThrow();
      } else {
        expect(fstatSync(fixture.lock.descriptor).dev).toBe(
          fixture.lock.identity.device,
        );
      }
      closeAbandonedFinalizationLock(fixture);
    }
  });

  test("each directory fsync failure preserves the automatically captured durable snapshot", () => {
    const baseline = finalizationBaselineTrace();
    expect(baseline.fsyncBefore).toHaveLength(9);
    for (const targetIndex of baseline.fsyncBefore.keys()) {
      const fixture = finalizationTestFixture();
      const oracle = new FinalizationSnapshotOracle(fixture);
      let calls = 0;
      let captured: FinalizationSnapshot | null = null;
      expect(() =>
        runFinalizationFixture(fixture, {
          afterBegin: () => oracle.commit(fixture.paths.stateDirectory),
          fsyncDirectory: (path, descriptors) => {
            const index = calls++;
            if (index === targetIndex) {
              captured = oracle.capture(descriptors);
              throw new Error(`fsync_${index}`);
            }
            fsyncTestDirectory(path);
            oracle.commit(path);
          },
        })
      ).toThrow(`fsync_${targetIndex}`);
      expect(calls).toBe(targetIndex + 1);
      expect(captured).toEqual(baseline.fsyncBefore[targetIndex]);
      const remainingDescriptors = fixture.lock.phase === "released"
        ? []
        : [{ role: "lock" as const, descriptor: fixture.lock.descriptor }];
      const afterThrow = oracle.capture(remainingDescriptors);
      expect(afterThrow.visible).toEqual(captured!.visible);
      expect(afterThrow.durable).toEqual(captured!.durable);
      closeAbandonedFinalizationLock(fixture);
    }
  });

  test("bundle, path, directory, symlink, and hardlink substitutions refuse before retirement", () => {
    const pathMutations: Array<[
      string,
      (fixture: FinalizationTestFixture) => void,
    ]> = [
      ["witness-claim-swap", (fixture) => {
        [fixture.paths.witnessPath, fixture.paths.markerRetirementClaimPath] = [
          fixture.paths.markerRetirementClaimPath,
          fixture.paths.witnessPath,
        ];
      }],
      ["receipt-stage-alias", (fixture) => {
        fixture.paths.receiptStagePath = fixture.paths.receiptPath;
      }],
      ["lock-marker-alias", (fixture) => {
        fixture.paths.publicLockPath = fixture.paths.markerPath;
      }],
      ["authority-witness-claim-swap", (fixture) => {
        [
          fixture.authorityPaths.witnessPath,
          fixture.authorityPaths.markerRetirementClaimPath,
        ] = [
          fixture.authorityPaths.markerRetirementClaimPath,
          fixture.authorityPaths.witnessPath,
        ];
      }],
      ["same-directory-inode", (fixture) => {
        fixture.paths.receiptDirectory = fixture.paths.stateDirectory;
        fixture.paths.receiptPath = join(
          fixture.paths.stateDirectory,
          basename(fixture.authorityPaths.receiptPath),
        );
        fixture.paths.receiptStagePath = join(
          fixture.paths.stateDirectory,
          basename(fixture.authorityPaths.receiptStagePath),
        );
      }],
      ["symlink-state-directory", (fixture) => {
        const alias = join(fixture.root, "state-alias");
        symlinkSync(fixture.paths.stateDirectory, alias);
        fixture.paths.stateDirectory = alias;
        fixture.paths.markerPath = join(
          alias,
          basename(fixture.paths.markerPath),
        );
        fixture.paths.markerRetirementClaimPath = join(
          alias,
          basename(fixture.paths.markerRetirementClaimPath),
        );
        fixture.paths.witnessPath = join(
          alias,
          basename(fixture.paths.witnessPath),
        );
        fixture.paths.witnessStagePath = join(
          alias,
          basename(fixture.paths.witnessStagePath),
        );
      }],
    ];
    for (const [name, mutate] of pathMutations) {
      const fixture = finalizationTestFixture();
      mutate(fixture);
      expect(() => runFinalizationFixture(fixture), name).toThrow(
        MaintenanceRefenceError,
      );
      expect(fixture.counts.begin, name).toBe(0);
      expect(fixture.lock.phase, name).toBe("held");
      closeAbandonedFinalizationLock(fixture);
    }

    const markerAlias = finalizationTestFixture();
    linkSync(
      markerAlias.paths.markerPath,
      markerAlias.paths.markerRetirementClaimPath,
    );
    expect(() => runFinalizationFixture(markerAlias)).toThrow(
      MaintenanceRefenceError,
    );
    expect(markerAlias.counts.begin).toBe(0);
    closeAbandonedFinalizationLock(markerAlias);

    const substituted = finalizationTestFixture();
    const alternativeRequest = successArtifactRequestFixture({
      successProvenAt: "2026-08-25T12:31:00Z",
      lock: {
        ownerPath: substituted.artifacts.witness.lock_owner_path,
        device: substituted.lock.identity.device,
        inode: substituted.lock.identity.inode,
        sha256: substituted.lock.identity.sha256,
        pid: process.pid,
      },
    });
    substituted.artifacts = createSuccessArtifactsForTest(alternativeRequest);
    expect(() => runFinalizationFixture(substituted)).toThrow();
    expect(substituted.counts.begin).toBe(1);
    expect(sha256(readFileSync(substituted.paths.markerPath))).toBe(
      substituted.preMarkerSHA256,
    );
    expect(substituted.lock.phase).toBe("held");
    closeAbandonedFinalizationLock(substituted);
  });

  test("collisions and pre/post-link inode, hash, mode, and nlink drift refuse", () => {
    for (
      const key of [
        "markerRetirementClaimPath",
        "receiptPath",
        "receiptStagePath",
        "witnessPath",
        "witnessStagePath",
      ] as const
    ) {
      const fixture = finalizationTestFixture();
      writeFileSync(fixture.paths[key], "foreign", { mode: 0o600 });
      expect(() => runFinalizationFixture(fixture)).toThrow(
        MaintenanceRefenceError,
      );
      expect(fixture.counts).toEqual({ begin: 0, pre: 0, closed: 0 });
      closeAbandonedFinalizationLock(fixture);
    }

    const replaceWithSameBytes = (
      fixture: FinalizationTestFixture,
      path: string,
      bytes: string,
      role: SuccessFinalizationOpenDescriptor["role"],
      descriptors: readonly SuccessFinalizationOpenDescriptor[],
    ): void => {
      const retained = descriptors.find((entry) => entry.role === role);
      expect(retained, `${role} descriptor retained`).toBeDefined();
      const before = fstatSync(retained!.descriptor);
      expect(before.nlink, `${role} original link count`).toBe(1);
      unlinkSync(path);
      const unlinked = fstatSync(retained!.descriptor);
      expect(unlinked.dev, `${role} retained device`).toBe(before.dev);
      expect(unlinked.ino, `${role} retained inode`).toBe(before.ino);
      expect(unlinked.nlink, `${role} retained unlink`).toBe(0);
      writeFileSync(path, bytes, { mode: 0o600 });
      const replacement = lstatSync(path);
      expect(replacement.isFile(), `${role} replacement regular`).toBeTrue();
      expect(replacement.mode & 0o777, `${role} replacement mode`).toBe(0o600);
      expect(replacement.size, `${role} replacement size`).toBe(
        Buffer.byteLength(bytes),
      );
      expect(sha256(readFileSync(path)), `${role} replacement hash`).toBe(
        sha256(bytes),
      );
      expect(replacement.dev, `${role} replacement device`).toBe(before.dev);
      expect(replacement.ino, `${role} replacement inode`).not.toBe(
        before.ino,
      );
      expect(fixture.lock.phase, `${role} mutation precedes release`).toBe(
        role === "lock" ? "public_unlinked" : "held",
      );
    };
    const mutations: Array<{
      name: string;
      point: SuccessFinalizationCrashPoint;
      mutate(
        fixture: FinalizationTestFixture,
        descriptors: readonly SuccessFinalizationOpenDescriptor[],
      ): void;
    }> = [
      {
        name: "receipt stage mode drift at R1",
        point: "R1",
        mutate: (fixture) => chmodSync(fixture.paths.receiptStagePath, 0o644),
      },
      {
        name: "receipt stage hash drift at R1",
        point: "R1",
        mutate: (fixture) =>
          writeFileSync(fixture.paths.receiptStagePath, "hash-drift"),
      },
      {
        name: "receipt same-byte inode substitution at R1",
        point: "R1",
        mutate: (fixture, descriptors) => {
          replaceWithSameBytes(
            fixture,
            fixture.paths.receiptStagePath,
            fixture.artifacts.receiptBytesUTF8,
            "receipt",
            descriptors,
          );
        },
      },
      {
        name: "receipt foreign hardlink at R1",
        point: "R1",
        mutate: (fixture) =>
          linkSync(
            fixture.paths.receiptStagePath,
            join(fixture.paths.receiptDirectory, "foreign-receipt-link"),
          ),
      },
      {
        name: "receipt canonical inode substitution after link",
        point: "R2_linked_before_directory_fsync",
        mutate: (fixture) => {
          unlinkSync(fixture.paths.receiptPath);
          writeFileSync(
            fixture.paths.receiptPath,
            fixture.artifacts.receiptBytesUTF8,
            { mode: 0o600 },
          );
        },
      },
      {
        name: "receipt canonical foreign hardlink after durability",
        point: "R3",
        mutate: (fixture) =>
          linkSync(
            fixture.paths.receiptPath,
            join(fixture.paths.receiptDirectory, "foreign-receipt-link"),
          ),
      },
      {
        name: "witness same-byte inode substitution at W1",
        point: "W1",
        mutate: (fixture, descriptors) => {
          replaceWithSameBytes(
            fixture,
            fixture.paths.witnessStagePath,
            fixture.artifacts.witnessBytesUTF8,
            "witness",
            descriptors,
          );
        },
      },
      {
        name: "marker same-byte inode substitution before M1",
        point: "W1",
        mutate: (fixture, descriptors) => {
          replaceWithSameBytes(
            fixture,
            fixture.paths.markerPath,
            fixture.artifacts.markerBytesUTF8,
            "marker",
            descriptors,
          );
        },
      },
      {
        name: "marker claim inode substitution after link",
        point: "M1_linked_before_directory_fsync",
        mutate: (fixture) => {
          unlinkSync(fixture.paths.markerRetirementClaimPath);
          writeFileSync(
            fixture.paths.markerRetirementClaimPath,
            fixture.artifacts.markerBytesUTF8,
            { mode: 0o600 },
          );
        },
      },
      {
        name: "marker claim inode substitution after canonical unlink",
        point: "M2_unlinked_before_directory_fsync",
        mutate: (fixture) => {
          unlinkSync(fixture.paths.markerRetirementClaimPath);
          writeFileSync(
            fixture.paths.markerRetirementClaimPath,
            fixture.artifacts.markerBytesUTF8,
            { mode: 0o600 },
          );
        },
      },
      {
        name: "witness canonical mode drift after link",
        point: "W2_linked_before_directory_fsync",
        mutate: (fixture) => chmodSync(fixture.paths.witnessPath, 0o644),
      },
      {
        name: "witness canonical foreign hardlink after durability",
        point: "W3",
        mutate: (fixture) =>
          linkSync(
            fixture.paths.witnessPath,
            join(fixture.paths.stateDirectory, "foreign-witness-link"),
          ),
      },
      {
        name: "marker claim recreation after unlink",
        point: "M3_unlinked_before_directory_fsync",
        mutate: (fixture) =>
          writeFileSync(
            fixture.paths.markerRetirementClaimPath,
            fixture.artifacts.markerBytesUTF8,
            { mode: 0o600 },
          ),
      },
      {
        name: "lock owner same-byte inode substitution after public unlink",
        point: "L1_unlinked_before_directory_fsync",
        mutate: (fixture, descriptors) => {
          replaceWithSameBytes(
            fixture,
            fixture.lock.ownerPath,
            fixture.lock.recordBytes,
            "lock",
            descriptors,
          );
        },
      },
    ];
    for (const mutation of mutations) {
      const fixture = finalizationTestFixture();
      let injected = false;
      expect(() =>
        runFinalizationFixture(fixture, {
          crash: (point, descriptors) => {
            if (point !== mutation.point || injected) return;
            injected = true;
            mutation.mutate(fixture, descriptors);
          },
        }), mutation.name).toThrow(MaintenanceRefenceError);
      expect(injected, mutation.name).toBeTrue();
      expect(fixture.lock.phase, mutation.name).not.toBe("released");
      closeAbandonedFinalizationLock(fixture);
    }
  });

  test("post-A0 finalization has no child, Git, Keychain, DB, Fly, or HTTP path", () => {
    const source = readFileSync(
      join(import.meta.dir, "..", "phase-b-refence-maintenance-bridge.ts"),
      "utf8",
    );
    const start = source.indexOf(
      "export function performSuccessFinalizationCeremony(",
    );
    const end = source.indexOf("function requirePrivateDirectory(", start);
    const body = source.slice(start, end);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(body).not.toMatch(
      /Bun\.spawn|readProduction|runRefenceFly|fetch\(|sql\.|security|DATABASE_URL|GIT_/,
    );
    expect(body.match(/request\.verifyClosedLocalAuthority\(\)/g)).toHaveLength(
      1,
    );
    expect(body.indexOf("request.verifyClosedLocalAuthority();"))
      .toBeGreaterThan(
        body.indexOf('crash("M3")'),
      );
  });
});
