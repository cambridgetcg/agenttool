import type { TelescopeLimits } from "../types.js";

export interface ParseSuccess<T> {
  ok: true;
  value: T;
  warnings: string[];
}

export interface ParseFailure {
  ok: false;
  code: string;
}

export type ParseResult<T> = ParseSuccess<T> | ParseFailure;

export function parseFailure(code: string): ParseFailure {
  return { ok: false, code };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readBoundedString(
  value: unknown,
  maxLength = 2_048,
): string | null {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength
    ? value
    : null;
}

export function isExactSemver(value: string): boolean {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(
    value,
  );
}

export function isNpmPackageName(value: string): boolean {
  if (value.length > 214 || value.toLowerCase() !== value) return false;
  if (value === "node_modules" || value === "favicon.ico") return false;
  return /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/.test(
    value,
  );
}

function validateJsonComplexity(
  value: unknown,
  limits: TelescopeLimits,
): boolean {
  let nodes = 0;
  const visit = (current: unknown, depth: number): boolean => {
    nodes += 1;
    if (nodes > limits.max_json_nodes || depth > limits.max_json_depth) {
      return false;
    }
    if (Array.isArray(current)) {
      return current.every((entry) => visit(entry, depth + 1));
    }
    if (isRecord(current)) {
      return Object.values(current).every((entry) => visit(entry, depth + 1));
    }
    return true;
  };
  return visit(value, 0);
}

export function decodeUtf8(body: Uint8Array): ParseResult<string> {
  try {
    return {
      ok: true,
      value: new TextDecoder("utf-8", { fatal: true }).decode(body),
      warnings: [],
    };
  } catch {
    return parseFailure("invalid_utf8");
  }
}

export function parseJsonBody(
  body: Uint8Array,
  limits: TelescopeLimits,
): ParseResult<unknown> {
  const decoded = decodeUtf8(body);
  if (!decoded.ok) return decoded;
  let value: unknown;
  try {
    value = JSON.parse(decoded.value) as unknown;
  } catch {
    return parseFailure("invalid_json");
  }
  if (!validateJsonComplexity(value, limits)) {
    return parseFailure("json_complexity_limit");
  }
  return { ok: true, value, warnings: [] };
}
