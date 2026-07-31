import {
  HF_ORIGIN,
  LOVE_MODEL_LOCK_SCHEMA,
} from "./constants.js";
import { canonicalJson, sha256Hex } from "./canonical.js";
import { invariant } from "./errors.js";
import type { LoveModelLockProjection } from "./types.js";
import {
  asPlainObject,
  assertExactKeys,
  compareUnicode,
  normalizeFullSha,
  normalizeRepoId,
  normalizeSha1,
  normalizeSha256,
  safeInteger,
  safeRelativeHubPath,
  safeRemoteString,
} from "./validation.js";

const LOCK_KEYS = [
  "schema",
  "repo_type",
  "repo_id",
  "revision",
  "hub_url",
  "last_modified",
  "license",
  "base_model",
  "task",
  "library",
  "files",
] as const;

const LOCK_FILE_KEYS = ["path", "size", "sha256", "git_blob_sha1"] as const;

export function projectLoveModelLock(value: unknown): LoveModelLockProjection {
  const lock = asPlainObject(value, "invalid_model_lock");
  assertExactKeys(lock, LOCK_KEYS, "invalid_model_lock");
  invariant(lock.schema === LOVE_MODEL_LOCK_SCHEMA, "invalid_model_lock", "model lock schema is unsupported");
  invariant(lock.repo_type === "model", "invalid_model_lock", "model lock repo type is unsupported");

  const repoIdRaw = safeRemoteString(lock.repo_id, 193);
  invariant(repoIdRaw, "invalid_model_lock", "model lock repo id is invalid");
  const repoId = normalizeRepoId("model", repoIdRaw);
  const revision = normalizeFullSha(lock.revision);
  invariant(revision, "invalid_model_lock", "model lock revision must be a full commit SHA");
  const expectedHubUrl = canonicalModelUrl(repoId);
  invariant(lock.hub_url === expectedHubUrl, "invalid_model_lock", "model lock Hub URL does not match its repo id");

  const lastModified = lock.last_modified === null
    ? null
    : safeRemoteString(lock.last_modified, 64);
  invariant(
    lastModified === null || Number.isFinite(new Date(lastModified).getTime()),
    "invalid_model_lock",
    "model lock timestamp is invalid",
  );
  const license = requiredText(lock.license, "license", 128);
  const baseModel = normalizeBaseModel(lock.base_model);
  const task = nullableText(lock.task, "task", 128);
  const library = nullableText(lock.library, "library", 128);
  invariant(Array.isArray(lock.files) && lock.files.length > 0 && lock.files.length <= 10_000, "invalid_model_lock", "model lock files are invalid");

  const paths = new Set<string>();
  let totalBytes = 0;
  let previousPath: string | null = null;
  for (const rawFile of lock.files) {
    const file = asPlainObject(rawFile, "invalid_model_lock");
    assertExactKeys(file, LOCK_FILE_KEYS, "invalid_model_lock");
    const path = safeRelativeHubPath(file.path);
    invariant(path && !paths.has(path), "invalid_model_lock", "model lock contains an invalid file path");
    invariant(previousPath === null || compareUnicode(previousPath, path) < 0, "invalid_model_lock", "model lock files must be sorted");
    paths.add(path);
    previousPath = path;
    const size = safeInteger(file.size);
    invariant(size !== null, "invalid_model_lock", "model lock contains an invalid file size");
    invariant(normalizeSha256(file.sha256), "invalid_model_lock", "model lock contains an invalid SHA-256");
    invariant(
      file.git_blob_sha1 === undefined
        || file.git_blob_sha1 === null
        || normalizeSha1(file.git_blob_sha1),
      "invalid_model_lock",
      "model lock contains an invalid Git blob SHA-1",
    );
    totalBytes += size;
    invariant(Number.isSafeInteger(totalBytes), "invalid_model_lock", "model lock total size is invalid");
  }

  return {
    schema: "kingdom-love-model-lock-projection/v0.1",
    lock_schema: LOVE_MODEL_LOCK_SCHEMA,
    repo_id: repoId,
    revision,
    declared: {
      license,
      base_model: baseModel,
      task,
      library,
    },
    file_count: lock.files.length,
    total_bytes: totalBytes,
    lock_sha256: sha256Hex(canonicalJson(lock)),
    verification: "metadata_lock_only",
    snapshot_verified: false,
  };
}

function requiredText(value: unknown, label: string, maxLength: number): string {
  const normalized = safeRemoteString(value, maxLength);
  invariant(normalized, "invalid_model_lock", `model lock ${label} is invalid`);
  return normalized;
}

function nullableText(value: unknown, label: string, maxLength: number): string | null {
  if (value === null) return null;
  return requiredText(value, label, maxLength);
}

function normalizeBaseModel(value: unknown): string | string[] | null {
  if (value === null) return null;
  if (Array.isArray(value)) {
    invariant(
      value.length > 0 && value.length <= 1_000,
      "invalid_model_lock",
      "model lock base_model is invalid",
    );
    return value.map((entry) => normalizeRepoId(
      "model",
      requiredText(entry, "base_model", 193),
    ));
  }
  return normalizeRepoId("model", requiredText(value, "base_model", 193));
}

function canonicalModelUrl(repoId: string): string {
  const encoded = repoId.split("/").map((part) => encodeURIComponent(part)).join("/");
  return `${HF_ORIGIN}/${encoded}`;
}
