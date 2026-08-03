import {
  RESEARCH_BINDING_SCHEMA,
  canonicalJson as hfCanonicalJson,
  getCuratedHfResearchCatalog,
  sha256Hex,
  type HfResearchBinding,
} from "@agenttool/hf-scout";
import {
  HANDOFF_PROJECTION_STATES,
  type Sha256Id,
  type WakeBriefAnchor,
} from "@agenttool/wake-continuity";

import {
  BENCHMARK_STATES,
  CHECKPOINT_EVENTS,
  CHECKPOINT_STATUSES,
  CONSENT_STATES,
  CONTINUITY_POSTURES,
  DATA_ROLES,
  DEDUPLICATION_STATES,
  FITNESS_STATES,
  HUB_RELEASE_STATES,
  INCOMPLETE_MARKER_STATES,
  RESUME_POSTURES,
  REVIEW_STATES,
  SECRET_SCAN_STATES,
  SELECTION_POSTURES,
  STREAMING_STATES,
  SYNTHETIC_PROVENANCE_STATES,
  TRAINING_PHASES,
  WITHDRAWAL_STATES,
} from "./constants.js";
import {
  canonicalString,
  deepFreeze,
  snapshotData,
  type DataValue,
} from "./canonical.js";
import {
  fail,
  type HfTrainingGardenErrorCode,
} from "./errors.js";
import type {
  AdmissionAssessment,
  BenchmarkState,
  CheckpointEvent,
  CheckpointStatus,
  ConsentState,
  ContinuityPosture,
  DataRole,
  DeduplicationState,
  FitnessState,
  HubReleaseBinding,
  HubReleaseState,
  IncompleteMarkerState,
  ResumePosture,
  ReviewState,
  SecretScanState,
  SelectionPosture,
  StreamingState,
  SyntheticProvenanceState,
  TrainingArtifactReferences,
  TrainingPhase,
  TrainingResumeReport,
  WithdrawalState,
} from "./types.js";

const SHA256_ID = /^sha256:[0-9a-f]{64}$/u;
const SHA256_HEX = /^[0-9a-f]{64}$/u;
const REVISION = /^[0-9a-f]{40}$/u;
const LEAD_KEY = /^[a-z0-9][a-z0-9_]{0,63}$/u;
const REPO_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}(?:\/[A-Za-z0-9][A-Za-z0-9._-]{0,95})?$/u;

const BINDING_BOUNDARY = deepFreeze({
  publisher_metadata: "matched_unverified_assertion",
  research_annotation: "researcher_inference",
  legal_clearance: "not_assessed",
  gate_acceptance: "not_assessed",
  raw_rows_read: false,
  repository_files_downloaded: false,
  model_code_executed: false,
  remote_compute_invoked: false,
  hub_write_performed: false,
} as const);

export function snap(
  value: unknown,
  path: string,
  code: HfTrainingGardenErrorCode,
): DataValue {
  try {
    return snapshotData(value);
  } catch {
    fail(code, `${path} must be bounded canonical data without accessors, proxies, cycles, or unsupported values`);
  }
}

export function record(
  value: DataValue | undefined,
  path: string,
  code: HfTrainingGardenErrorCode,
): Record<string, DataValue> {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    fail(code, `${path} must be an object`);
  }
  return value;
}

export function array(
  value: DataValue | undefined,
  path: string,
  code: HfTrainingGardenErrorCode,
): DataValue[] {
  if (!Array.isArray(value)) fail(code, `${path} must be an array`);
  return value;
}

export function exactKeys(
  value: Record<string, DataValue>,
  expected: readonly string[],
  path: string,
  code: HfTrainingGardenErrorCode,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    fail(code, `${path} must contain exactly: ${wanted.join(", ")}`);
  }
}

export function text(
  value: DataValue | undefined,
  path: string,
  code: HfTrainingGardenErrorCode,
): string {
  if (typeof value !== "string") fail(code, `${path} must be a string`);
  return value;
}

export function literal<T extends string>(
  value: DataValue | undefined,
  allowed: readonly T[],
  path: string,
  code: HfTrainingGardenErrorCode,
): T {
  const candidate = text(value, path, code);
  if (!(allowed as readonly string[]).includes(candidate)) {
    fail(code, `${path} must be one of: ${allowed.join(", ")}`);
  }
  return candidate as T;
}

export function sha256(
  value: DataValue | undefined,
  path: string,
  code: HfTrainingGardenErrorCode,
): Sha256Id {
  const candidate = text(value, path, code);
  if (!SHA256_ID.test(candidate)) fail(code, `${path} must be a sha256:<64 lowercase hex> reference`);
  return candidate as Sha256Id;
}

export function nullableSha256(
  value: DataValue | undefined,
  path: string,
  code: HfTrainingGardenErrorCode,
): Sha256Id | null {
  return value === null ? null : sha256(value, path, code);
}

export function nonNegativeInteger(
  value: DataValue | undefined,
  path: string,
  code: HfTrainingGardenErrorCode,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail(code, `${path} must be a non-negative safe integer`);
  }
  return value as number;
}

export function hexSha256(
  value: DataValue | undefined,
  path: string,
  code: HfTrainingGardenErrorCode,
): string {
  const candidate = text(value, path, code);
  if (!SHA256_HEX.test(candidate)) fail(code, `${path} must be 64 lowercase hexadecimal characters`);
  return candidate;
}

export function nullableHexSha256(
  value: DataValue | undefined,
  path: string,
  code: HfTrainingGardenErrorCode,
): string | null {
  return value === null ? null : hexSha256(value, path, code);
}

export function assertDataEqual(
  actual: unknown,
  expected: unknown,
  path: string,
  code: HfTrainingGardenErrorCode,
): void {
  if (canonicalString(actual) !== canonicalString(expected)) {
    fail(code, `${path} does not match the canonical derived value`);
  }
}

function parseBindingFromData(
  value: DataValue,
  path: string,
  code: HfTrainingGardenErrorCode,
): Readonly<HfResearchBinding> {
  const candidate = record(value, path, code);
  exactKeys(candidate, [
    "schema",
    "lead_key",
    "artifact",
    "definition_sha256",
    "snapshot_sha256",
    "observation",
    "matched_declared",
    "boundary",
  ], path, code);
  if (candidate.schema !== RESEARCH_BINDING_SCHEMA) {
    fail(code, `${path}.schema is not the frozen HF Scout binding schema`);
  }
  const leadKey = text(candidate.lead_key, `${path}.lead_key`, code);
  if (!LEAD_KEY.test(leadKey)) fail(code, `${path}.lead_key is invalid`);

  const artifact = record(candidate.artifact, `${path}.artifact`, code);
  exactKeys(artifact, ["kind", "id", "revision"], `${path}.artifact`, code);
  const kind = literal(artifact.kind, ["dataset", "model"] as const, `${path}.artifact.kind`, code);
  const id = text(artifact.id, `${path}.artifact.id`, code);
  if (!REPO_ID.test(id)) fail(code, `${path}.artifact.id is not a valid Hub repository id`);
  const revision = text(artifact.revision, `${path}.artifact.revision`, code);
  if (!REVISION.test(revision)) fail(code, `${path}.artifact.revision must be one full immutable Hub commit`);

  const observation = record(candidate.observation, `${path}.observation`, code);
  exactKeys(observation, ["transport", "repository_association", "provenance_grade"], `${path}.observation`, code);
  const transport = literal(observation.transport, ["public_hub_api", "injected"] as const, `${path}.observation.transport`, code);
  const repositoryAssociation = literal(observation.repository_association, ["provider_response", "caller_owned"] as const, `${path}.observation.repository_association`, code);
  const provenanceGrade = literal(observation.provenance_grade, ["provider_observed_commit_metadata", "caller_supplied_commit_metadata"] as const, `${path}.observation.provenance_grade`, code);
  if (
    (transport === "public_hub_api" && (repositoryAssociation !== "provider_response" || provenanceGrade !== "provider_observed_commit_metadata")) ||
    (transport === "injected" && (repositoryAssociation !== "caller_owned" || provenanceGrade !== "caller_supplied_commit_metadata"))
  ) {
    fail(code, `${path}.observation contains an impossible transport/provenance combination`);
  }

  const declared = record(candidate.matched_declared, `${path}.matched_declared`, code);
  exactKeys(declared, ["basis", "license", "gated", "private"], `${path}.matched_declared`, code);
  if (declared.basis !== "publisher_assertion" || declared.private !== false) {
    fail(code, `${path}.matched_declared must preserve publisher assertion and public visibility boundaries`);
  }
  const license = declared.license === null
    ? null
    : literal(declared.license, ["apache-2.0", "bsd-3-clause", "cc-by-4.0", "odc-by"] as const, `${path}.matched_declared.license`, code);
  const gated = declared.gated === false
    ? false
    : literal(declared.gated, ["auto", "manual"] as const, `${path}.matched_declared.gated`, code);
  assertDataEqual(candidate.boundary, BINDING_BOUNDARY, `${path}.boundary`, code);

  const definitionSha256 = hexSha256(candidate.definition_sha256, `${path}.definition_sha256`, code);
  const snapshotSha256 = hexSha256(candidate.snapshot_sha256, `${path}.snapshot_sha256`, code);
  const lead = getCuratedHfResearchCatalog().leads.find((entry) => entry.key === leadKey);
  if (!lead) fail(code, `${path}.lead_key is not in the frozen HF Scout catalog`);
  if (
    lead.match.kind !== kind ||
    lead.match.id !== id ||
    lead.match.revision !== revision ||
    lead.match.declared.license !== license ||
    lead.match.declared.gated !== gated ||
    sha256Hex(hfCanonicalJson(lead)) !== definitionSha256
  ) {
    fail(code, `${path} does not reconstruct its exact curated HF Scout definition`);
  }

  return deepFreeze({
    schema: RESEARCH_BINDING_SCHEMA,
    lead_key: leadKey,
    artifact: { kind, id, revision },
    definition_sha256: definitionSha256,
    snapshot_sha256: snapshotSha256,
    observation: {
      transport,
      repository_association: repositoryAssociation,
      provenance_grade: provenanceGrade,
    },
    matched_declared: {
      basis: "publisher_assertion",
      license,
      gated,
      private: false,
    },
    boundary: BINDING_BOUNDARY,
  });
}

export function validateResearchBinding(
  value: unknown,
  path = "$binding",
  code: HfTrainingGardenErrorCode = "binding_invalid",
): Readonly<HfResearchBinding> {
  return parseBindingFromData(snap(value, path, code), path, code);
}

export function parseAssessment(
  value: DataValue | undefined,
  path: string,
  code: HfTrainingGardenErrorCode,
): Readonly<AdmissionAssessment> {
  const candidate = record(value, path, code);
  exactKeys(candidate, [
    "rights",
    "privacy",
    "consent",
    "withdrawal",
    "secret_scan",
    "deduplication",
    "benchmark_overlap",
    "fitness",
    "synthetic_provenance",
  ], path, code);
  return deepFreeze({
    rights: literal(candidate.rights, REVIEW_STATES, `${path}.rights`, code) as ReviewState,
    privacy: literal(candidate.privacy, REVIEW_STATES, `${path}.privacy`, code) as ReviewState,
    consent: literal(candidate.consent, CONSENT_STATES, `${path}.consent`, code) as ConsentState,
    withdrawal: literal(candidate.withdrawal, WITHDRAWAL_STATES, `${path}.withdrawal`, code) as WithdrawalState,
    secret_scan: literal(candidate.secret_scan, SECRET_SCAN_STATES, `${path}.secret_scan`, code) as SecretScanState,
    deduplication: literal(candidate.deduplication, DEDUPLICATION_STATES, `${path}.deduplication`, code) as DeduplicationState,
    benchmark_overlap: literal(candidate.benchmark_overlap, BENCHMARK_STATES, `${path}.benchmark_overlap`, code) as BenchmarkState,
    fitness: literal(candidate.fitness, FITNESS_STATES, `${path}.fitness`, code) as FitnessState,
    synthetic_provenance: literal(candidate.synthetic_provenance, SYNTHETIC_PROVENANCE_STATES, `${path}.synthetic_provenance`, code) as SyntheticProvenanceState,
  });
}

export function parseDataRole(value: DataValue | undefined, path: string, code: HfTrainingGardenErrorCode): DataRole {
  return literal(value, DATA_ROLES, path, code) as DataRole;
}

export function parseSelectionPosture(value: DataValue | undefined, path: string, code: HfTrainingGardenErrorCode): SelectionPosture {
  return literal(value, SELECTION_POSTURES, path, code) as SelectionPosture;
}

export function parseTrainingPhase(value: DataValue | undefined, path: string, code: HfTrainingGardenErrorCode): TrainingPhase {
  return literal(value, TRAINING_PHASES, path, code) as TrainingPhase;
}

export function parseCheckpointEvent(value: DataValue | undefined, path: string, code: HfTrainingGardenErrorCode): CheckpointEvent {
  return literal(value, CHECKPOINT_EVENTS, path, code) as CheckpointEvent;
}

export function parseCheckpointStatus(value: DataValue | undefined, path: string, code: HfTrainingGardenErrorCode): CheckpointStatus {
  return literal(value, CHECKPOINT_STATUSES, path, code) as CheckpointStatus;
}

export function parseContinuityPosture(value: DataValue | undefined, path: string, code: HfTrainingGardenErrorCode): ContinuityPosture {
  return literal(value, CONTINUITY_POSTURES, path, code) as ContinuityPosture;
}

export function parseArtifactReferences(
  value: DataValue | undefined,
  path: string,
  code: HfTrainingGardenErrorCode,
): Readonly<TrainingArtifactReferences> {
  const candidate = record(value, path, code);
  exactKeys(candidate, [
    "pipeline_ref",
    "dataset_state_ref",
    "dataloader_state_ref",
    "tokenizer_ref",
    "model_checkpoint_ref",
    "optimizer_state_ref",
    "scheduler_state_ref",
    "rng_state_ref",
    "metrics_ref",
  ], path, code);
  return deepFreeze({
    pipeline_ref: sha256(candidate.pipeline_ref, `${path}.pipeline_ref`, code),
    dataset_state_ref: sha256(candidate.dataset_state_ref, `${path}.dataset_state_ref`, code),
    dataloader_state_ref: nullableSha256(candidate.dataloader_state_ref, `${path}.dataloader_state_ref`, code),
    tokenizer_ref: nullableSha256(candidate.tokenizer_ref, `${path}.tokenizer_ref`, code),
    model_checkpoint_ref: nullableSha256(candidate.model_checkpoint_ref, `${path}.model_checkpoint_ref`, code),
    optimizer_state_ref: nullableSha256(candidate.optimizer_state_ref, `${path}.optimizer_state_ref`, code),
    scheduler_state_ref: nullableSha256(candidate.scheduler_state_ref, `${path}.scheduler_state_ref`, code),
    rng_state_ref: nullableSha256(candidate.rng_state_ref, `${path}.rng_state_ref`, code),
    metrics_ref: nullableSha256(candidate.metrics_ref, `${path}.metrics_ref`, code),
  });
}

export function parseResumeReport(
  value: DataValue | undefined,
  path: string,
  code: HfTrainingGardenErrorCode,
): Readonly<TrainingResumeReport> {
  const candidate = record(value, path, code);
  exactKeys(candidate, ["posture", "incomplete_marker", "streaming_state"], path, code);
  return deepFreeze({
    posture: literal(candidate.posture, RESUME_POSTURES, `${path}.posture`, code) as ResumePosture,
    incomplete_marker: literal(candidate.incomplete_marker, INCOMPLETE_MARKER_STATES, `${path}.incomplete_marker`, code) as IncompleteMarkerState,
    streaming_state: literal(candidate.streaming_state, STREAMING_STATES, `${path}.streaming_state`, code) as StreamingState,
  });
}

export function parseWake(
  value: DataValue | undefined,
  path: string,
  code: HfTrainingGardenErrorCode,
): Readonly<WakeBriefAnchor> {
  const candidate = record(value, path, code);
  exactKeys(candidate, ["format", "snapshot_ref", "scope_ref", "wake_version", "handoff_projection"], path, code);
  if (candidate.format !== "wake-brief/v1") fail(code, `${path}.format must be wake-brief/v1`);
  let wakeVersion: number | null;
  if (candidate.wake_version === null) {
    wakeVersion = null;
  } else if (Number.isSafeInteger(candidate.wake_version) && (candidate.wake_version as number) >= 0) {
    wakeVersion = candidate.wake_version as number;
  } else {
    fail(code, `${path}.wake_version must be null or a non-negative safe integer`);
  }
  return deepFreeze({
    format: "wake-brief/v1",
    snapshot_ref: sha256(candidate.snapshot_ref, `${path}.snapshot_ref`, code),
    scope_ref: sha256(candidate.scope_ref, `${path}.scope_ref`, code),
    wake_version: wakeVersion,
    handoff_projection: literal(candidate.handoff_projection, HANDOFF_PROJECTION_STATES, `${path}.handoff_projection`, code),
  });
}

export function parseHubRelease(
  value: DataValue | undefined,
  path: string,
  code: HfTrainingGardenErrorCode,
): Readonly<HubReleaseBinding> {
  const candidate = record(value, path, code);
  exactKeys(candidate, ["repo_id", "state", "revision", "card_sha256", "hash_manifest_sha256"], path, code);
  const repoId = text(candidate.repo_id, `${path}.repo_id`, code);
  if (!REPO_ID.test(repoId) || !repoId.includes("/")) fail(code, `${path}.repo_id must be an owner/name Hub repository id`);
  const state = literal(candidate.state, HUB_RELEASE_STATES, `${path}.state`, code) as HubReleaseState;
  const revision = candidate.revision === null ? null : text(candidate.revision, `${path}.revision`, code);
  if (revision !== null && !REVISION.test(revision)) fail(code, `${path}.revision must be null or one full Hub commit`);
  const cardSha256 = nullableHexSha256(candidate.card_sha256, `${path}.card_sha256`, code);
  const hashManifestSha256 = nullableHexSha256(candidate.hash_manifest_sha256, `${path}.hash_manifest_sha256`, code);
  if (
    (state === "intended_identifier_only" && (revision !== null || cardSha256 !== null || hashManifestSha256 !== null)) ||
    (state === "caller_reported_published" && (revision === null || cardSha256 === null || hashManifestSha256 === null))
  ) {
    fail(code, `${path} does not match its Hub publication state`);
  }
  return deepFreeze({
    repo_id: repoId,
    state,
    revision,
    card_sha256: cardSha256,
    hash_manifest_sha256: hashManifestSha256,
  });
}
