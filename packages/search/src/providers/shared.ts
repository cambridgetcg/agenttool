import { DEFAULT_SEARCH_LIMITS } from "../constants.js";
import type {
  SearchKind,
  ProviderSearchRequest,
} from "../types.js";
import { FixedJsonTransportError } from "./transport.js";

export function validateProviderRequest(
  request: ProviderSearchRequest,
): void {
  if (
    !request
    || typeof request !== "object"
    || typeof request.query !== "string"
    || request.query.trim().length === 0
    || request.query.length > DEFAULT_SEARCH_LIMITS.max_query_chars
    || !Array.isArray(request.kinds)
    || !Number.isSafeInteger(request.limit)
    || request.limit < 1
    || request.limit > DEFAULT_SEARCH_LIMITS.max_provider_results
    || (
      request.cursor !== undefined
      && (
        typeof request.cursor !== "string"
        || request.cursor.length === 0
        || request.cursor.length > DEFAULT_SEARCH_LIMITS.max_url_chars
      )
    )
  ) {
    throw new FixedJsonTransportError("provider_request_invalid");
  }
}

export function kindRequested(
  request: ProviderSearchRequest,
  kind: SearchKind,
): boolean {
  return request.kinds.length === 0 || request.kinds.includes(kind);
}

export function requiredText(
  input: unknown,
  maxChars: number,
): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim();
  if (value.length === 0) return null;
  return value.slice(0, maxChars);
}

export function optionalText(
  input: unknown,
  maxChars: number,
): string | undefined {
  return requiredText(input, maxChars) ?? undefined;
}

export function stringList(
  input: unknown,
  maxItems: number,
  maxChars = 256,
): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  for (const item of input) {
    const value = optionalText(item, maxChars);
    if (value === undefined || seen.has(value)) continue;
    seen.add(value);
    if (seen.size >= maxItems) break;
  }
  return [...seen];
}

export function optionalTimestamp(input: unknown): string | undefined {
  if (typeof input !== "string" || input.length > 128) return undefined;
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u
      .test(input)
  ) {
    return undefined;
  }
  const timestamp = Date.parse(input);
  if (!Number.isFinite(timestamp)) return undefined;
  return new Date(timestamp).toISOString();
}

export function optionalNonNegativeNumber(
  input: unknown,
): number | undefined {
  return typeof input === "number"
    && Number.isFinite(input)
    && input >= 0
    ? input
    : undefined;
}

export function safeHttpUrl(input: unknown): string | undefined {
  if (
    typeof input !== "string"
    || input.length === 0
    || input.length > DEFAULT_SEARCH_LIMITS.max_url_chars
  ) {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return undefined;
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:")
    || url.username !== ""
    || url.password !== ""
  ) {
    return undefined;
  }
  return url.toString();
}

export function isObject(
  input: unknown,
): input is Record<string, unknown> {
  return input !== null && typeof input === "object" && !Array.isArray(input);
}

export function encodePathSegment(input: string): string {
  return encodeURIComponent(input).replace(/[!'()*]/gu, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
