import {
  HF_ORIGIN,
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
      status: "private_local_prototype",
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
  const revision = snapshot.revision.full_sha;
  invariant(
    revision && snapshot.revision.state === "immutable_commit",
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
        schema: "agenttool-hf-artifact/v0.1",
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

function cloneReportSnapshot(report: HfScoutReport): HfArtifactSnapshot {
  invariant(report.schema === REPORT_SCHEMA, "invalid_report", "HF Scout report schema is invalid");
  const transport = asPlainObject(report.transport, "invalid_report");
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
  const snapshot = cloneSnapshot(report.snapshot);
  invariant(
    snapshot.observation.transport === transport.kind,
    "invalid_report",
    "HF Scout report and snapshot transports do not match",
  );
  return snapshot;
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
  invariant(artifact.schema === "agenttool-hf-artifact/v0.1", "invalid_artifact", "artifact schema is invalid");

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
  assertExactKeys(revision, ["full_sha", "state"], "invalid_artifact");
  const fullSha = normalizeFullSha(revision.full_sha);
  invariant(
    revision.full_sha === null || fullSha !== null,
    "invalid_artifact",
    "artifact revision is invalid",
  );
  const expectedRevisionState = fullSha ? "immutable_commit" : "unresolved";
  invariant(revision.state === expectedRevisionState, "invalid_artifact", "artifact revision state is inconsistent");

  const observation = asPlainObject(artifact.observation, "invalid_artifact");
  assertExactKeys(
    observation,
    ["transport", "repository_association"],
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
  const expectedGrade = fullSha
    ? observation.transport === "public_hub_api"
      ? "provider_observed_commit_metadata"
      : "caller_supplied_commit_metadata"
    : "mutable_observation";
  invariant(
    artifact.provenance_grade === expectedGrade,
    "invalid_artifact",
    "artifact provenance grade is inconsistent",
  );
  const boundaryCodes = validatedBoundaryCodes(artifact.boundary_codes);

  return {
    schema: "agenttool-hf-artifact/v0.1",
    subject: { provider: "huggingface", kind, id },
    revision: { full_sha: fullSha, state: expectedRevisionState },
    observation: {
      transport: observation.transport,
      repository_association: expectedAssociation,
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
    schema: "kingdom-hf-artifact-reference/v0.1",
    subject: {
      kind: snapshot.subject.kind,
      id: snapshot.subject.id,
    },
    revision: snapshot.revision.full_sha,
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
