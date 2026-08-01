import { snapshotJson, type JsonValue } from "./canonical.js";
import {
  EVIDENCE_ORIGINS,
  RESOURCE_KINDS,
} from "./constants.js";
import { fail, type DeepSeekKingdomErrorCode } from "./errors.js";
import type { DeepSeekEvidencePin, Sha256Id } from "./types.js";

const SHA256_ID = /^sha256:[0-9a-f]{64}$/u;
const FULL_SHA = /^[0-9a-f]{40}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@+\-]*$/u;
const REPOSITORY_ID = /^deepseek-ai\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/u;
const ARXIV_ID = /^\d{4}\.\d{4,5}$/u;
const ARXIV_VERSION = /^(\d{4}\.\d{4,5})v[1-9][0-9]*$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const UNSAFE_TEXT =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u206f]/u;

export function record(
  value: unknown,
  path: string,
  code: DeepSeekKingdomErrorCode,
): Record<string, JsonValue> {
  const snapshot = snapshotJson(value);
  if (snapshot === null || Array.isArray(snapshot) || typeof snapshot !== "object") {
    fail(code, `${path} must be a plain object`);
  }
  return snapshot;
}

export function exactKeys(
  value: Record<string, JsonValue>,
  expected: readonly string[],
  path: string,
  code: DeepSeekKingdomErrorCode,
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
  value: JsonValue | undefined,
  path: string,
  code: DeepSeekKingdomErrorCode,
  maxLength: number,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength ||
    UNSAFE_TEXT.test(value)
  ) {
    fail(code, `${path} must be bounded safe text`);
  }
  return value;
}

export function id(
  value: JsonValue | undefined,
  path: string,
  code: DeepSeekKingdomErrorCode,
  maxLength = 160,
): string {
  const candidate = text(value, path, code, maxLength);
  if (!SAFE_ID.test(candidate)) fail(code, `${path} must be a safe identifier`);
  return candidate;
}

export function sha256(
  value: JsonValue | undefined,
  path: string,
  code: DeepSeekKingdomErrorCode,
): Sha256Id {
  const candidate = text(value, path, code, 71);
  if (!SHA256_ID.test(candidate)) {
    fail(code, `${path} must be a lowercase sha256: content identifier`);
  }
  return candidate as Sha256Id;
}

export function literal<T extends string>(
  value: JsonValue | undefined,
  allowed: readonly T[],
  path: string,
  code: DeepSeekKingdomErrorCode,
): T {
  const candidate = text(value, path, code, 128);
  if (!(allowed as readonly string[]).includes(candidate)) {
    fail(code, `${path} must be one of: ${allowed.join(", ")}`);
  }
  return candidate as T;
}

export function evidencePin(
  value: unknown,
  path: string,
  code: DeepSeekKingdomErrorCode,
): DeepSeekEvidencePin {
  const candidate = record(value, path, code);
  exactKeys(
    candidate,
    ["origin", "resource_kind", "repository_id", "revision", "path", "sha256", "observed_on"],
    path,
    code,
  );
  const origin = literal(candidate.origin, EVIDENCE_ORIGINS, `${path}.origin`, code);
  const resourceKind = literal(
    candidate.resource_kind,
    RESOURCE_KINDS,
    `${path}.resource_kind`,
    code,
  );
  const repositoryId = text(candidate.repository_id, `${path}.repository_id`, code, 193);
  const revision = text(candidate.revision, `${path}.revision`, code, 64);
  const observedOn = text(candidate.observed_on, `${path}.observed_on`, code, 10);
  const observedDate = new Date(`${observedOn}T00:00:00.000Z`);
  if (
    !DATE.test(observedOn) ||
    Number.isNaN(observedDate.getTime()) ||
    observedDate.toISOString().slice(0, 10) !== observedOn
  ) {
    fail(code, `${path}.observed_on must be an ISO calendar date`);
  }

  let evidencePath: string | null;
  if (candidate.path === null) {
    evidencePath = null;
  } else {
    evidencePath = text(candidate.path, `${path}.path`, code, 512);
    if (
      evidencePath.startsWith("/") ||
      evidencePath.includes("\\") ||
      evidencePath.includes("//") ||
      evidencePath.split("/").some((part) => part === "." || part === ".." || part.length === 0)
    ) {
      fail(code, `${path}.path must be a safe relative path`);
    }
  }

  if (origin === "deepseek_github") {
    if (
      resourceKind !== "code_repository" ||
      !REPOSITORY_ID.test(repositoryId) ||
      !FULL_SHA.test(revision) ||
      evidencePath === null
    ) {
      fail(code, `${path} is not a pinned official DeepSeek GitHub document`);
    }
  } else if (origin === "deepseek_huggingface") {
    if (
      (resourceKind !== "model_repository" && resourceKind !== "dataset_repository") ||
      !REPOSITORY_ID.test(repositoryId) ||
      !FULL_SHA.test(revision) ||
      evidencePath === null
    ) {
      fail(code, `${path} is not a pinned official DeepSeek Hugging Face document`);
    }
  } else {
    const match = ARXIV_VERSION.exec(revision);
    if (
      resourceKind !== "paper" ||
      !ARXIV_ID.test(repositoryId) ||
      match?.[1] !== repositoryId ||
      evidencePath !== null
    ) {
      fail(code, `${path} is not a versioned arXiv primary paper`);
    }
  }

  return {
    origin,
    resource_kind: resourceKind,
    repository_id: repositoryId,
    revision,
    path: evidencePath,
    sha256: sha256(candidate.sha256, `${path}.sha256`, code),
    observed_on: observedOn,
  };
}

export function sameEvidenceSubject(
  left: DeepSeekEvidencePin,
  right: DeepSeekEvidencePin,
): boolean {
  return left.origin === right.origin &&
    left.resource_kind === right.resource_kind &&
    left.repository_id === right.repository_id &&
    left.revision === right.revision;
}
