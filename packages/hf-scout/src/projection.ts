import {
  ARTIFACT_SCHEMA,
  HF_ORIGIN,
  RECONCILIATION_SCHEMA,
  REPORT_SCHEMA,
  SIDECAR_SCHEMA,
  TOOL_NAME,
  TOOL_VERSION,
} from "./constants.js";
import { canonicalJson, sha256Hex } from "./canonical.js";
import { invariant } from "./errors.js";
import type {
  AgentDataTextCollectRequest,
  HfArtifactSnapshot,
  HfLocalVerificationReport,
  HfManifestComparison,
  HfReleaseReconciliationReport,
  HfReleaseSourceDeclaration,
  HfScoutReport,
  KingdomHfArtifactReference,
  KingdomHfSidecar,
  LoveModelLockProjection,
} from "./types.js";
import {
  asPlainObject,
  assertExactKeys,
  assertRepoKind,
  compareUnicode,
  normalizeFullSha,
  normalizeObservedAt,
  normalizeRepoId,
  normalizeSha1,
  normalizeSha256,
  safeInteger,
  safeRelativeHubPath,
  safeRemoteString,
} from "./validation.js";
import type { HfBoundaryCode } from "./types.js";

export interface KingdomHfSidecarInput {
  generated_at: string;
  reports?: readonly HfScoutReport[];
  model_locks?: readonly LoveModelLockProjection[];
}

export interface HfReleaseReconciliationInput {
  release_report: HfScoutReport;
  head_report: HfScoutReport;
  source_declaration?: HfReleaseSourceDeclaration;
  local_verification?: HfLocalVerificationReport;
}

export function createKingdomHfSidecar(
  input: KingdomHfSidecarInput,
): KingdomHfSidecar {
  const generatedAt = normalizeObservedAt(input.generated_at);
  invariant(
    (input.reports?.length ?? 0) <= 1_000,
    "too_many_artifacts",
    "sidecar accepts at most 1000 artifacts",
  );
  invariant(
    (input.model_locks?.length ?? 0) <= 1_000,
    "too_many_model_locks",
    "sidecar accepts at most 1000 model locks",
  );
  const artifacts = (input.reports ?? []).map((report) => {
    return projectKingdomArtifactReference(cloneReportSnapshot(report));
  });
  const locks = (input.model_locks ?? []).map((lock) => cloneLock(lock));
  assertUnique(
    artifacts.map((artifact) => `${artifact.subject.kind}:${artifact.subject.id}`),
    "duplicate_artifact",
  );
  assertUnique(locks.map((lock) => lock.repo_id), "duplicate_model_lock");
  artifacts.sort(compareSnapshots);
  locks.sort((left, right) => compareUnicode(left.repo_id, right.repo_id));

  return deepFreeze({
    schema: SIDECAR_SCHEMA,
    generated_at: generatedAt,
    extension: {
      package: TOOL_NAME,
      version: TOOL_VERSION,
      status: "developer_preview",
    },
    artifacts,
    model_locks: locks,
    boundary: {
      publisher_metadata: "unverified",
      source_transport_effects: "carried_in_artifact_observation",
      projector_hub_files_downloaded: false,
      projector_model_code_executed: false,
      projector_remote_compute_invoked: false,
      projector_hub_write_performed: false,
    },
  });
}

export function projectAgentDataTextRequest(
  report: HfScoutReport,
  collectionId = "kingdom-hf-scout",
): AgentDataTextCollectRequest {
  invariant(
    /^[a-z0-9][a-z0-9._-]{0,63}$/u.test(collectionId),
    "invalid_collection_id",
    "Agent Data collection id is invalid",
  );
  const snapshot = cloneReportSnapshot(report);
  const revision = snapshot.revision.resolved_full_sha;
  invariant(
    revision
      && snapshot.revision.requested_full_sha === revision
      && snapshot.revision.state === "exact_revision_match",
    "mutable_artifact",
    "Agent Data projection requires a full immutable commit SHA",
  );
  invariant(
    snapshot.subject.kind !== "paper",
    "unsupported_projection",
    "paper observations do not have a Hub repository commit tree",
  );
  const identity = `hf:${snapshot.subject.kind}:${snapshot.subject.id}`;
  const text = canonicalJson(snapshot);
  const snapshotSha256 = sha256Hex(text);
  const version = `${revision}:sha256:${snapshotSha256}`;
  return {
    collection_id: collectionId,
    collector_id: "text",
    input: {
      text,
      media_type: "application/json",
      source_uri: `${canonicalHubUrl(snapshot.subject.kind, snapshot.subject.id)}/tree/${revision}`,
      external_id: `${identity}@${version}`,
      key: identity,
      version,
      observed_at: normalizeObservedAt(report.observed_at),
      metadata: {
        schema: ARTIFACT_SCHEMA,
        provider: "huggingface",
        repo_kind: snapshot.subject.kind,
        repo_id: snapshot.subject.id,
        revision,
        snapshot_sha256: snapshotSha256,
        transport: snapshot.observation.transport,
        repository_association: snapshot.observation.repository_association,
        taint: "remote_untrusted",
      },
    },
  };
}

export function createHfReleaseReconciliation(
  input: HfReleaseReconciliationInput,
): HfReleaseReconciliationReport {
  const release = cloneReportSnapshot(input.release_report);
  const head = cloneReportSnapshot(input.head_report);
  const observedAt = normalizeObservedAt(input.release_report.observed_at);
  invariant(
    normalizeObservedAt(input.head_report.observed_at) === observedAt,
    "reconciliation_time_mismatch",
    "release and head observations must use the same observation time",
  );
  invariant(
    release.subject.kind === head.subject.kind
      && release.subject.id === head.subject.id,
    "reconciliation_subject_mismatch",
    "release and head observations must describe the same repository",
  );
  const releaseKind = release.subject.kind;
  invariant(
    releaseKind === "model" || releaseKind === "dataset" || releaseKind === "space",
    "unsupported_reconciliation_kind",
    "release reconciliation supports model, dataset, or space repositories",
  );
  const requestedRevision = release.revision.requested_full_sha;
  const resolvedRevision = release.revision.resolved_full_sha;
  invariant(
    requestedRevision
      && resolvedRevision === requestedRevision
      && release.revision.state === "exact_revision_match"
      && release.observation.reference === "requested_exact_revision",
    "reconciliation_release_not_exact",
    "release reconciliation requires an exact matched revision observation",
  );
  invariant(
    head.revision.requested_full_sha === null
      && head.observation.reference === "current_head",
    "reconciliation_head_not_mutable",
    "release reconciliation requires a separate current-head observation",
  );

  const observedFileManifestSha256 = release.file_inventory === "complete"
    ? sha256Hex(canonicalJson(release.files))
    : null;
  const sourceDeclaration = normalizeSourceDeclaration(
    input.source_declaration,
    observedFileManifestSha256,
  );
  const localVerification = normalizeLocalVerification(
    input.local_verification,
    requestedRevision,
    observedFileManifestSha256,
  );
  const headRevision = head.revision.resolved_full_sha;

  return deepFreeze({
    schema: RECONCILIATION_SCHEMA,
    tool: { name: TOOL_NAME, version: TOOL_VERSION },
    operation: "reconcile_release",
    observed_at: observedAt,
    subject: {
      provider: "huggingface",
      kind: releaseKind,
      id: release.subject.id,
    },
    release: {
      requested_revision: requestedRevision,
      resolved_revision: resolvedRevision,
      state: "exact_requested_revision_observed",
      observation: { ...release.observation },
      snapshot_sha256: sha256Hex(canonicalJson(release)),
      file_inventory: release.file_inventory,
      observed_file_manifest_sha256: observedFileManifestSha256,
      observed_file_count: release.files.length,
      observed_total_bytes: totalObservedBytes(release),
    },
    observed_head: {
      requested_reference: "current_head",
      resolved_revision: headRevision,
      state: headRevision === null
        ? "unresolved"
        : headRevision === requestedRevision
          ? "matches_release"
          : "differs_from_release",
      observation: { ...head.observation },
      snapshot_sha256: sha256Hex(canonicalJson(head)),
    },
    publisher_claims: {
      basis: "publisher_assertion",
      release: release.declared,
      observed_head: head.declared,
    },
    source_declaration: sourceDeclaration,
    local_verification: localVerification,
    boundary: {
      publisher_claims: "unverified",
      source_declaration: "caller_supplied_or_absent",
      local_verification: "caller_reported_or_absent",
      license_truth: "not_established",
      consent: "not_established",
      training_authority: "not_established",
      safety: "not_established",
      compatibility: "not_established",
      hub_files_downloaded: false,
      model_code_executed: false,
      remote_compute_invoked: false,
      hub_write_performed: false,
    },
  });
}

function normalizeSourceDeclaration(
  value: HfReleaseSourceDeclaration | undefined,
  observedManifest: string | null,
): HfReleaseReconciliationReport["source_declaration"] {
  if (value === undefined) {
    return {
      state: "not_provided",
      basis: null,
      source_revision: null,
      source_manifest_sha256: null,
      manifest_comparison: "not_comparable",
    };
  }
  const source = asPlainObject(value, "invalid_source_declaration");
  assertExactKeys(
    source,
    ["basis", "source_revision", "source_manifest_sha256"],
    "invalid_source_declaration",
  );
  invariant(
    source.basis === "caller_declaration",
    "invalid_source_declaration",
    "source declaration basis is invalid",
  );
  const sourceRevision = normalizeNullableFullSha(
    source.source_revision,
    "invalid_source_declaration",
    "source declaration revision is invalid",
  );
  const sourceManifest = normalizeNullableSha256(
    source.source_manifest_sha256,
    "invalid_source_declaration",
    "source declaration manifest digest is invalid",
  );
  invariant(
    sourceRevision !== null || sourceManifest !== null,
    "invalid_source_declaration",
    "source declaration must contain a revision or manifest digest",
  );
  return {
    state: "caller_supplied",
    basis: "caller_declaration",
    source_revision: sourceRevision,
    source_manifest_sha256: sourceManifest,
    manifest_comparison: compareManifest(sourceManifest, observedManifest),
  };
}

function normalizeLocalVerification(
  value: HfLocalVerificationReport | undefined,
  releaseRevision: string,
  observedManifest: string | null,
): HfReleaseReconciliationReport["local_verification"] {
  if (value === undefined) {
    return {
      state: "not_provided",
      basis: null,
      release_revision: null,
      file_manifest_sha256: null,
      verified_file_count: null,
      verified_total_bytes: null,
      manifest_comparison: "not_comparable",
    };
  }
  const local = asPlainObject(value, "invalid_local_verification");
  assertExactKeys(
    local,
    [
      "basis",
      "release_revision",
      "file_manifest_sha256",
      "verified_file_count",
      "verified_total_bytes",
    ],
    "invalid_local_verification",
  );
  invariant(
    local.basis === "caller_supplied_local_verification",
    "invalid_local_verification",
    "local verification basis is invalid",
  );
  const localRevision = normalizeFullSha(local.release_revision);
  invariant(
    localRevision === releaseRevision,
    "local_verification_revision_mismatch",
    "local verification revision does not match the release",
  );
  const localManifest = normalizeSha256(local.file_manifest_sha256);
  invariant(
    localManifest,
    "invalid_local_verification",
    "local verification manifest digest is invalid",
  );
  const verifiedFileCount = safeInteger(local.verified_file_count);
  const verifiedTotalBytes = safeInteger(local.verified_total_bytes);
  invariant(
    verifiedFileCount !== null && verifiedFileCount <= 10_000,
    "invalid_local_verification",
    "local verification file count is invalid",
  );
  invariant(
    verifiedTotalBytes !== null,
    "invalid_local_verification",
    "local verification byte count is invalid",
  );
  return {
    state: "caller_reported",
    basis: "caller_supplied_local_verification",
    release_revision: localRevision,
    file_manifest_sha256: localManifest,
    verified_file_count: verifiedFileCount,
    verified_total_bytes: verifiedTotalBytes,
    manifest_comparison: compareManifest(localManifest, observedManifest),
  };
}

function compareManifest(
  declared: string | null,
  observed: string | null,
): HfManifestComparison {
  if (declared === null || observed === null) return "not_comparable";
  return declared === observed
    ? "matches_provider_observation"
    : "differs_from_provider_observation";
}

function totalObservedBytes(snapshot: HfArtifactSnapshot): number | null {
  let total = 0;
  for (const file of snapshot.files) {
    if (file.size === null || total > Number.MAX_SAFE_INTEGER - file.size) return null;
    total += file.size;
  }
  return total;
}

function normalizeNullableFullSha(
  value: unknown,
  code: string,
  message: string,
): string | null {
  if (value === null) return null;
  const normalized = normalizeFullSha(value);
  invariant(normalized, code, message);
  return normalized;
}

function normalizeNullableSha256(
  value: unknown,
  code: string,
  message: string,
): string | null {
  if (value === null) return null;
  const normalized = normalizeSha256(value);
  invariant(normalized, code, message);
  return normalized;
}

function cloneReportSnapshot(report: HfScoutReport): HfArtifactSnapshot {
  const object = asPlainObject(report, "invalid_report");
  assertExactKeys(
    object,
    [
      "schema",
      "tool",
      "operation",
      "observed_at",
      "status",
      "transport",
      "snapshot",
      "diagnostics",
    ],
    "invalid_report",
  );
  invariant(object.schema === REPORT_SCHEMA, "invalid_report", "HF Scout report schema is invalid");
  const tool = asPlainObject(object.tool, "invalid_report");
  assertExactKeys(tool, ["name", "version"], "invalid_report");
  invariant(
    tool.name === TOOL_NAME && tool.version === TOOL_VERSION,
    "invalid_report",
    "HF Scout report tool identity is invalid",
  );
  invariant(
    object.operation === "inspect",
    "invalid_report",
    "HF Scout report operation is invalid",
  );
  invariant(
    typeof object.observed_at === "string",
    "invalid_report",
    "HF Scout report observation time is invalid",
  );
  normalizeObservedAt(object.observed_at);
  invariant(
    object.status === "observed" || object.status === "partial",
    "invalid_report",
    "HF Scout report status is invalid",
  );
  invariant(
    Array.isArray(object.diagnostics) && object.diagnostics.length <= 32,
    "invalid_report",
    "HF Scout report diagnostics are invalid",
  );
  for (const value of object.diagnostics) validateDiagnostic(value);
  invariant(
    object.status === (object.diagnostics.length === 0 ? "observed" : "partial"),
    "invalid_report",
    "HF Scout report status is inconsistent",
  );

  const transport = asPlainObject(object.transport, "invalid_report");
  assertExactKeys(
    transport,
    ["kind", "requested_effect", "credentials", "retries", "response_body"],
    "invalid_report",
  );
  invariant(transport.requested_effect === "read_only", "invalid_report", "HF Scout report transport is invalid");
  if (transport.kind === "public_hub_api") {
    invariant(
      transport.credentials === "omit_requested"
        && transport.retries === 0
        && transport.response_body === "bounded",
      "invalid_report",
      "HF Scout report transport is inconsistent",
    );
  } else {
    invariant(transport.kind === "injected", "invalid_report", "HF Scout report transport is invalid");
    invariant(
      transport.credentials === "caller_owned"
        && transport.retries === "caller_owned"
        && transport.response_body === "caller_owned",
      "invalid_report",
      "HF Scout report transport is inconsistent",
    );
  }
  const snapshot = cloneSnapshot(object.snapshot as HfArtifactSnapshot);
  invariant(
    snapshot.observation.transport === transport.kind,
    "invalid_report",
    "HF Scout report and snapshot transports do not match",
  );
  return snapshot;
}

function validateDiagnostic(value: unknown): void {
  const diagnostic = asPlainObject(value, "invalid_report");
  assertExactKeys(diagnostic, ["code", "level", "message"], "invalid_report");
  const codes = new Set([
    "content_commitments_partial",
    "declared_relations_truncated",
    "file_inventory_truncated",
    "file_inventory_unavailable",
    "license_unknown",
    "revision_unresolved",
    "search_entries_omitted",
    "search_metadata_truncated",
    "search_truncated",
    "tags_omitted",
    "tags_truncated",
  ]);
  invariant(
    codes.has(String(diagnostic.code))
      && diagnostic.level === "warning"
      && safeRemoteString(diagnostic.message, 256) !== null,
    "invalid_report",
    "HF Scout report diagnostic is invalid",
  );
}

function cloneSnapshot(value: HfArtifactSnapshot): HfArtifactSnapshot {
  const artifact = asPlainObject(value, "invalid_artifact");
  assertExactKeys(
    artifact,
    [
      "schema",
      "subject",
      "revision",
      "observation",
      "declared",
      "file_inventory",
      "files",
      "provenance_grade",
      "boundary_codes",
    ],
    "invalid_artifact",
  );
  invariant(artifact.schema === ARTIFACT_SCHEMA, "invalid_artifact", "artifact schema is invalid");

  const subject = asPlainObject(artifact.subject, "invalid_artifact");
  assertExactKeys(subject, ["provider", "kind", "id"], "invalid_artifact");
  invariant(subject.provider === "huggingface", "invalid_artifact", "artifact provider is invalid");
  invariant(typeof subject.kind === "string", "invalid_artifact", "artifact repo kind is invalid");
  assertRepoKind(subject.kind);
  const kind = subject.kind;
  const rawId = safeRemoteString(subject.id, 193);
  invariant(rawId, "invalid_artifact", "artifact repo id is invalid");
  const id = normalizeRepoId(kind, rawId);

  const revision = asPlainObject(artifact.revision, "invalid_artifact");
  assertExactKeys(
    revision,
    ["requested_full_sha", "resolved_full_sha", "state"],
    "invalid_artifact",
  );
  const requestedFullSha = normalizeFullSha(revision.requested_full_sha);
  const resolvedFullSha = normalizeFullSha(revision.resolved_full_sha);
  invariant(
    revision.requested_full_sha === null || requestedFullSha !== null,
    "invalid_artifact",
    "artifact requested revision is invalid",
  );
  invariant(
    revision.resolved_full_sha === null || resolvedFullSha !== null,
    "invalid_artifact",
    "artifact resolved revision is invalid",
  );
  invariant(
    requestedFullSha === null || requestedFullSha === resolvedFullSha,
    "invalid_artifact",
    "artifact requested and resolved revisions differ",
  );
  const expectedRevisionState = requestedFullSha
    ? "exact_revision_match"
    : resolvedFullSha
      ? "mutable_head_observation"
      : "unresolved";
  invariant(revision.state === expectedRevisionState, "invalid_artifact", "artifact revision state is inconsistent");

  const observation = asPlainObject(artifact.observation, "invalid_artifact");
  assertExactKeys(
    observation,
    ["transport", "repository_association", "reference"],
    "invalid_artifact",
  );
  invariant(
    observation.transport === "public_hub_api" || observation.transport === "injected",
    "invalid_artifact",
    "artifact observation transport is invalid",
  );
  const expectedAssociation = observation.transport === "public_hub_api"
    ? "provider_response"
    : "caller_owned";
  invariant(
    observation.repository_association === expectedAssociation,
    "invalid_artifact",
    "artifact repository association is inconsistent",
  );
  const expectedReference = requestedFullSha
    ? "requested_exact_revision"
    : "current_head";
  invariant(
    observation.reference === expectedReference,
    "invalid_artifact",
    "artifact observation reference is inconsistent",
  );

  const declared = asPlainObject(artifact.declared, "invalid_artifact");
  assertExactKeys(
    declared,
    [
      "basis",
      "license",
      "task",
      "library",
      "gated",
      "private",
      "tags",
      "base_models",
      "papers",
    ],
    "invalid_artifact",
  );
  invariant(declared.basis === "publisher_assertion", "invalid_artifact", "artifact claim basis is invalid");
  const license = nullableText(declared.license, 128, "license");
  const task = nullableText(declared.task, 128, "task");
  const library = nullableText(declared.library, 128, "library");
  invariant(
    declared.gated === null
      || typeof declared.gated === "boolean"
      || declared.gated === "auto"
      || declared.gated === "manual",
    "invalid_artifact",
    "artifact gating claim is invalid",
  );
  invariant(
    declared.private === null || typeof declared.private === "boolean",
    "invalid_artifact",
    "artifact private claim is invalid",
  );
  const tags = validatedSortedStrings(declared.tags, 1_000, 256, "tags");
  const baseModels = validatedSortedStrings(declared.base_models, 1_000, 256, "base_models");
  const papers = validatedSortedStrings(declared.papers, 1_000, 256, "papers");

  invariant(
    artifact.file_inventory === "not_provided"
      || artifact.file_inventory === "complete"
      || artifact.file_inventory === "truncated",
    "invalid_artifact",
    "artifact file inventory state is invalid",
  );
  invariant(Array.isArray(artifact.files) && artifact.files.length <= 10_000, "invalid_artifact", "artifact files are invalid");
  const files = artifact.files.map((rawFile) => validatedFile(rawFile));
  for (let index = 1; index < files.length; index += 1) {
    invariant(
      compareUnicode(files[index - 1]!.path, files[index]!.path) < 0,
      "invalid_artifact",
      "artifact files must be sorted and unique",
    );
  }
  invariant(
    artifact.file_inventory !== "not_provided" || files.length === 0,
    "invalid_artifact",
    "artifact file inventory state is inconsistent",
  );
  const expectedGrade = resolvedFullSha
    ? requestedFullSha
      ? observation.transport === "public_hub_api"
        ? "provider_observed_exact_revision_metadata"
        : "caller_supplied_exact_revision_metadata"
      : observation.transport === "public_hub_api"
        ? "provider_observed_mutable_head_metadata"
        : "caller_supplied_mutable_head_metadata"
    : "mutable_observation";
  invariant(
    artifact.provenance_grade === expectedGrade,
    "invalid_artifact",
    "artifact provenance grade is inconsistent",
  );
  const boundaryCodes = validatedBoundaryCodes(artifact.boundary_codes);
  const expectedBoundaries = new Set<HfBoundaryCode>([
    "publisher_metadata_unverified",
    "scout_files_not_downloaded",
    "scout_model_code_not_executed",
  ]);
  if (observation.transport === "injected") expectedBoundaries.add("caller_owned_reader");
  if (requestedFullSha === null) expectedBoundaries.add("mutable_head_observation");
  if (resolvedFullSha === null) expectedBoundaries.add("revision_unresolved");
  if (license === null) expectedBoundaries.add("license_unknown");
  if (artifact.file_inventory !== "complete") expectedBoundaries.add("file_inventory_incomplete");
  invariant(
    boundaryCodes.length === expectedBoundaries.size
      && boundaryCodes.every((code) => expectedBoundaries.has(code)),
    "invalid_artifact",
    "artifact boundary codes are inconsistent",
  );

  return {
    schema: ARTIFACT_SCHEMA,
    subject: { provider: "huggingface", kind, id },
    revision: {
      requested_full_sha: requestedFullSha,
      resolved_full_sha: resolvedFullSha,
      state: expectedRevisionState,
    },
    observation: {
      transport: observation.transport,
      repository_association: expectedAssociation,
      reference: expectedReference,
    },
    declared: {
      basis: "publisher_assertion",
      license,
      task,
      library,
      gated: declared.gated,
      private: declared.private,
      tags,
      base_models: baseModels,
      papers,
    },
    file_inventory: artifact.file_inventory,
    files,
    provenance_grade: expectedGrade,
    boundary_codes: boundaryCodes,
  };
}

function cloneLock(value: LoveModelLockProjection): LoveModelLockProjection {
  const lock = asPlainObject(value, "invalid_model_lock_projection");
  assertExactKeys(
    lock,
    [
      "schema",
      "lock_schema",
      "repo_id",
      "revision",
      "declared",
      "file_count",
      "total_bytes",
      "lock_sha256",
      "verification",
      "snapshot_verified",
    ],
    "invalid_model_lock_projection",
  );
  invariant(
    lock.schema === "kingdom-love-model-lock-projection/v0.1"
      && lock.lock_schema === "love.huggingface-model-lock/v1",
    "invalid_model_lock_projection",
    "model lock projection schema is invalid",
  );
  const rawRepoId = safeRemoteString(lock.repo_id, 193);
  invariant(rawRepoId, "invalid_model_lock_projection", "model lock projection repo id is invalid");
  const repoId = normalizeRepoId("model", rawRepoId);
  const revision = normalizeFullSha(lock.revision);
  invariant(revision, "invalid_model_lock_projection", "model lock projection revision is invalid");
  const declared = asPlainObject(lock.declared, "invalid_model_lock_projection");
  assertExactKeys(declared, ["license", "base_model", "task", "library"], "invalid_model_lock_projection");
  const license = requiredText(declared.license, 128, "license");
  const baseModel = normalizeProjectedBaseModel(declared.base_model);
  const task = nullableProjectionText(declared.task, 128, "task");
  const library = nullableProjectionText(declared.library, 128, "library");
  const fileCount = safeInteger(lock.file_count);
  const totalBytes = safeInteger(lock.total_bytes);
  const lockSha256 = normalizeSha256(lock.lock_sha256);
  invariant(fileCount !== null && fileCount > 0 && fileCount <= 10_000, "invalid_model_lock_projection", "model lock projection file count is invalid");
  invariant(totalBytes !== null, "invalid_model_lock_projection", "model lock projection total size is invalid");
  invariant(lockSha256, "invalid_model_lock_projection", "model lock projection digest is invalid");
  invariant(
    lock.verification === "metadata_lock_only" && lock.snapshot_verified === false,
    "invalid_model_lock_projection",
    "model lock projection verification state is invalid",
  );
  return {
    schema: "kingdom-love-model-lock-projection/v0.1",
    lock_schema: "love.huggingface-model-lock/v1",
    repo_id: repoId,
    revision,
    declared: { license, base_model: baseModel, task, library },
    file_count: fileCount,
    total_bytes: totalBytes,
    lock_sha256: lockSha256,
    verification: "metadata_lock_only",
    snapshot_verified: false,
  };
}

function assertUnique(values: readonly string[], code: string): void {
  invariant(new Set(values).size === values.length, code, "sidecar contains duplicate logical identities");
}

function compareSnapshots(
  left: KingdomHfArtifactReference,
  right: KingdomHfArtifactReference,
): number {
  const leftKey = `${left.subject.kind}:${left.subject.id}`;
  const rightKey = `${right.subject.kind}:${right.subject.id}`;
  return compareUnicode(leftKey, rightKey);
}

function projectKingdomArtifactReference(
  snapshot: HfArtifactSnapshot,
): KingdomHfArtifactReference {
  return {
    schema: "kingdom-hf-artifact-reference/v0.2",
    subject: {
      kind: snapshot.subject.kind,
      id: snapshot.subject.id,
    },
    requested_revision: snapshot.revision.requested_full_sha,
    resolved_revision: snapshot.revision.resolved_full_sha,
    revision_state: snapshot.revision.state,
    snapshot_sha256: sha256Hex(canonicalJson(snapshot)),
    observation: { ...snapshot.observation },
    provenance_grade: snapshot.provenance_grade,
    license_declared: snapshot.declared.license,
    boundary_codes: [...snapshot.boundary_codes],
  };
}

function validatedFile(value: unknown): HfArtifactSnapshot["files"][number] {
  const file = asPlainObject(value, "invalid_artifact");
  assertExactKeys(
    file,
    ["path", "size", "sha256", "git_blob_sha1", "xet_hash", "basis", "verified_locally"],
    "invalid_artifact",
  );
  const path = safeRelativeHubPath(file.path);
  invariant(path, "invalid_artifact", "artifact file path is invalid");
  const size = safeInteger(file.size);
  invariant(file.size === null || size !== null, "invalid_artifact", "artifact file size is invalid");
  const sha256 = normalizeSha256(file.sha256);
  const gitBlobSha1 = normalizeSha1(file.git_blob_sha1);
  const xetHash = normalizeSha256(file.xet_hash);
  invariant(file.sha256 === null || sha256 !== null, "invalid_artifact", "artifact file SHA-256 is invalid");
  invariant(file.git_blob_sha1 === null || gitBlobSha1 !== null, "invalid_artifact", "artifact Git blob SHA-1 is invalid");
  invariant(file.xet_hash === null || xetHash !== null, "invalid_artifact", "artifact Xet hash is invalid");
  invariant(
    file.basis === "provider_metadata" && file.verified_locally === false,
    "invalid_artifact",
    "artifact file commitment basis is invalid",
  );
  return {
    path,
    size,
    sha256,
    git_blob_sha1: gitBlobSha1,
    xet_hash: xetHash,
    basis: "provider_metadata",
    verified_locally: false,
  };
}

function validatedSortedStrings(
  value: unknown,
  maxItems: number,
  maxLength: number,
  label: string,
): string[] {
  invariant(Array.isArray(value) && value.length <= maxItems, "invalid_artifact", `artifact ${label} is invalid`);
  const output = value.map((entry) => {
    const normalized = safeRemoteString(entry, maxLength);
    invariant(normalized, "invalid_artifact", `artifact ${label} is invalid`);
    return normalized;
  });
  for (let index = 1; index < output.length; index += 1) {
    invariant(
      compareUnicode(output[index - 1]!, output[index]!) < 0,
      "invalid_artifact",
      `artifact ${label} must be sorted and unique`,
    );
  }
  return output;
}

function nullableText(value: unknown, maxLength: number, label: string): string | null {
  if (value === null) return null;
  const normalized = safeRemoteString(value, maxLength);
  invariant(normalized, "invalid_artifact", `artifact ${label} is invalid`);
  return normalized;
}

function requiredText(value: unknown, maxLength: number, label: string): string {
  const normalized = safeRemoteString(value, maxLength);
  invariant(normalized, "invalid_model_lock_projection", `model lock projection ${label} is invalid`);
  return normalized;
}

function nullableProjectionText(
  value: unknown,
  maxLength: number,
  label: string,
): string | null {
  if (value === null) return null;
  return requiredText(value, maxLength, label);
}

function normalizeProjectedBaseModel(value: unknown): string | string[] | null {
  if (value === null) return null;
  if (Array.isArray(value)) {
    invariant(
      value.length > 0 && value.length <= 1_000,
      "invalid_model_lock_projection",
      "model lock projection base_model is invalid",
    );
    return value.map((entry) => normalizeRepoId(
      "model",
      requiredText(entry, 193, "base_model"),
    ));
  }
  return normalizeRepoId("model", requiredText(value, 193, "base_model"));
}

function validatedBoundaryCodes(value: unknown): HfBoundaryCode[] {
  const codes = validatedSortedStrings(value, 32, 64, "boundary_codes");
  const allowed = new Set<HfBoundaryCode>([
    "caller_owned_reader",
    "file_inventory_incomplete",
    "license_unknown",
    "mutable_head_observation",
    "publisher_metadata_unverified",
    "revision_unresolved",
    "scout_files_not_downloaded",
    "scout_model_code_not_executed",
  ]);
  invariant(
    codes.every((code): code is HfBoundaryCode => allowed.has(code as HfBoundaryCode)),
    "invalid_artifact",
    "artifact boundary code is invalid",
  );
  return codes;
}

function canonicalHubUrl(kind: HfArtifactSnapshot["subject"]["kind"], id: string): string {
  const encoded = id.split("/").map((part) => encodeURIComponent(part)).join("/");
  if (kind === "model") return `${HF_ORIGIN}/${encoded}`;
  if (kind === "paper") return `${HF_ORIGIN}/papers/${encoded}`;
  return `${HF_ORIGIN}/${kind}s/${encoded}`;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
