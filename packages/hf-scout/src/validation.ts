import { HfScoutError, invariant } from "./errors.js";
import type { HfRepoKind, HfScoutLimits } from "./types.js";

const UNSAFE_TEXT =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u206f]/u;
const REPO_SEGMENT = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,95})$/u;
const PAPER_ID = /^\d{4}\.\d{4,5}(?:v\d+)?$/u;
const FULL_SHA = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const SHA1 = /^[0-9a-f]{40}$/u;

export function assertRepoKind(value: string): asserts value is HfRepoKind {
  invariant(
    value === "model" || value === "dataset" || value === "space" || value === "paper",
    "invalid_repo_kind",
    "repo kind must be model, dataset, space, or paper",
  );
}

export function normalizeRepoId(kind: HfRepoKind, value: string): string {
  invariant(value.length > 0 && value.length <= 193, "invalid_repo_id", "repo id is invalid");
  invariant(!UNSAFE_TEXT.test(value), "invalid_repo_id", "repo id is invalid");
  if (kind === "paper") {
    invariant(PAPER_ID.test(value), "invalid_repo_id", "paper id is invalid");
    return value;
  }
  const parts = value.split("/");
  invariant(parts.length >= 1 && parts.length <= 2, "invalid_repo_id", "repo id is invalid");
  invariant(parts.every((part) => REPO_SEGMENT.test(part)), "invalid_repo_id", "repo id is invalid");
  return value;
}

export function normalizeQuery(value: string): string {
  invariant(value.length > 0 && value.length <= 160, "invalid_query", "search query is invalid");
  invariant(!UNSAFE_TEXT.test(value), "invalid_query", "search query is invalid");
  return value;
}

export function normalizeObservedAt(value: string): string {
  invariant(value.length <= 64, "invalid_observed_at", "observed_at is invalid");
  const date = new Date(value);
  invariant(Number.isFinite(date.getTime()), "invalid_observed_at", "observed_at is invalid");
  invariant(date.toISOString() === value, "invalid_observed_at", "observed_at must be canonical ISO-8601");
  return value;
}

export function normalizeFullSha(value: unknown): string | null {
  return typeof value === "string" && FULL_SHA.test(value) ? value : null;
}

export function normalizeSha256(value: unknown): string | null {
  return typeof value === "string" && SHA256.test(value) ? value : null;
}

export function normalizeSha1(value: unknown): string | null {
  return typeof value === "string" && SHA1.test(value) ? value : null;
}

export function safeRemoteString(value: unknown, maxLength = 256): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) return null;
  if (UNSAFE_TEXT.test(value) || hasUnpairedSurrogate(value)) return null;
  return value;
}

export function safeRelativeHubPath(value: unknown): string | null {
  const path = safeRemoteString(value, 512);
  if (!path || path.startsWith("/") || path.includes("\\") || path.includes("//")) return null;
  const parts = path.split("/");
  if (parts.some((part) => part.length === 0 || part === "." || part === "..")) return null;
  return path;
}

export function asPlainObject(value: unknown, code = "invalid_hub_response"): Record<string, unknown> {
  invariant(value !== null && typeof value === "object" && !Array.isArray(value), code, "Hub response has an unsupported shape");
  const prototype = Object.getPrototypeOf(value);
  invariant(prototype === Object.prototype || prototype === null, code, "Hub response has an unsupported shape");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  invariant(
    Object.values(descriptors).every((entry) => !entry.get && !entry.set),
    code,
    "Hub response has an unsupported shape",
  );
  return value as Record<string, unknown>;
}

export function optionalPlainObject(value: unknown): Record<string, unknown> | null {
  if (value === undefined || value === null) return null;
  try {
    return asPlainObject(value);
  } catch {
    return null;
  }
}

export function safeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function effectiveLimits(
  defaults: HfScoutLimits,
  overrides: Partial<HfScoutLimits> = {},
): HfScoutLimits {
  const result = { ...defaults, ...overrides };
  const entries = Object.entries(result) as Array<[keyof HfScoutLimits, number]>;
  for (const [key, value] of entries) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new HfScoutError("invalid_limit", `${key} must be a positive safe integer`);
    }
  }
  invariant(result.timeout_ms <= 60_000, "invalid_limit", "timeout_ms exceeds the hard maximum");
  invariant(
    result.max_response_bytes <= 4_194_304,
    "invalid_limit",
    "max_response_bytes exceeds the hard maximum",
  );
  invariant(result.max_search_results <= 100, "invalid_limit", "max_search_results exceeds the hard maximum");
  invariant(result.max_files <= 10_000, "invalid_limit", "max_files exceeds the hard maximum");
  invariant(result.max_tags <= 1_000, "invalid_limit", "max_tags exceeds the hard maximum");
  return Object.freeze(result);
}

export function assertExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  code: string,
): void {
  const allowedSet = new Set(allowed);
  invariant(Object.keys(value).every((key) => allowedSet.has(key)), code, "object contains unsupported fields");
}

export function compareUnicode(left: string, right: string): number {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0)!);
  const rightPoints = Array.from(right, (character) => character.codePointAt(0)!);
  const sharedLength = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const difference = leftPoints[index]! - rightPoints[index]!;
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  return leftPoints.length < rightPoints.length
    ? -1
    : leftPoints.length > rightPoints.length
      ? 1
      : 0;
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}
