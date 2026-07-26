import { createHash } from "node:crypto";

import type { ProviderTransportObservation } from "../types.js";

export const DEFAULT_PROVIDER_MAX_RESPONSE_BYTES = 1_048_576;

export type ProviderFetch = typeof globalThis.fetch;

export type FixedJsonTransportErrorCode =
  | "provider_request_invalid"
  | "provider_cursor_unsupported"
  | "provider_aborted"
  | "provider_network_error"
  | "provider_redirect"
  | "provider_http_error"
  | "provider_content_encoding_invalid"
  | "provider_content_length_invalid"
  | "provider_response_too_large"
  | "provider_media_type_invalid"
  | "provider_body_unavailable"
  | "provider_body_read_failed"
  | "provider_json_invalid"
  | "provider_response_invalid";

const ERROR_MESSAGES: Readonly<
  Record<FixedJsonTransportErrorCode, string>
> = Object.freeze({
  provider_request_invalid: "The provider request is invalid.",
  provider_cursor_unsupported: "This provider does not support cursors.",
  provider_aborted: "The provider request was cancelled or reached its deadline.",
  provider_network_error: "The provider request failed.",
  provider_redirect: "The fixed provider attempted to redirect.",
  provider_http_error: "The provider returned an unsuccessful HTTP status.",
  provider_content_encoding_invalid:
    "The provider did not honor the identity content-encoding boundary.",
  provider_content_length_invalid:
    "The provider returned an invalid Content-Length header.",
  provider_response_too_large:
    "The provider response exceeded the configured byte limit.",
  provider_media_type_invalid:
    "The provider response was not JSON.",
  provider_body_unavailable: "The provider response body was unavailable.",
  provider_body_read_failed: "The provider response body could not be read.",
  provider_json_invalid: "The provider response contained invalid JSON.",
  provider_response_invalid:
    "The provider response did not match the supported shape.",
});

/**
 * Stable provider error with no remote body, URL, exception text, or cursor.
 */
export class FixedJsonTransportError extends Error {
  readonly code: FixedJsonTransportErrorCode;

  constructor(code: FixedJsonTransportErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "FixedJsonTransportError";
    this.code = code;
  }
}

export interface FixedJsonFetchOptions {
  expected_origin: string;
  signal: AbortSignal;
  fetch?: ProviderFetch;
  max_response_bytes?: number;
  boundary_codes?: readonly string[];
}

export interface FixedJsonFetchResult {
  json: unknown;
  observation: ProviderTransportObservation;
}

/**
 * Fetch one JSON document from a caller-fixed HTTPS origin.
 *
 * There is deliberately no retry or redirect path. The request contains no
 * caller headers or credentials, and the returned observation has query values
 * redacted even though the selected provider necessarily receives the query.
 */
export async function fetchFixedJson(
  input: string | URL,
  options: FixedJsonFetchOptions,
): Promise<FixedJsonFetchResult> {
  const expectedOrigin = normalizeExpectedOrigin(options.expected_origin);
  const requestUrl = normalizeRequestUrl(input, expectedOrigin);
  const maxBytes = normalizeMaxBytes(options.max_response_bytes);
  const fetchImpl = options.fetch ?? globalThis.fetch;

  if (typeof fetchImpl !== "function") {
    throw new FixedJsonTransportError("provider_request_invalid");
  }
  if (!isAbortSignal(options.signal)) {
    throw new FixedJsonTransportError("provider_request_invalid");
  }
  if (options.signal.aborted) {
    throw new FixedJsonTransportError("provider_aborted");
  }

  let response: Response;
  try {
    response = await fetchImpl(requestUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "identity",
      },
      credentials: "omit",
      redirect: "manual",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal: options.signal,
    });
  } catch {
    throw new FixedJsonTransportError(
      options.signal.aborted
        ? "provider_aborted"
        : "provider_network_error",
    );
  }

  if (options.signal.aborted) {
    await cancelBody(response);
    throw new FixedJsonTransportError("provider_aborted");
  }
  if (
    response.redirected
    || (response.status >= 300 && response.status < 400)
  ) {
    await cancelBody(response);
    throw new FixedJsonTransportError("provider_redirect");
  }
  if (!response.ok) {
    await cancelBody(response);
    throw new FixedJsonTransportError("provider_http_error");
  }

  let responseUrl: URL;
  try {
    responseUrl = normalizeResponseUrl(response.url, requestUrl);
  } catch (error) {
    await cancelBody(response);
    throw error;
  }
  const contentEncoding = response.headers.get("content-encoding");
  if (
    contentEncoding !== null
    && contentEncoding.trim().toLowerCase() !== "identity"
  ) {
    await cancelBody(response);
    throw new FixedJsonTransportError(
      "provider_content_encoding_invalid",
    );
  }

  const mediaType = parseJsonMediaType(response.headers.get("content-type"));
  if (mediaType === null) {
    await cancelBody(response);
    throw new FixedJsonTransportError("provider_media_type_invalid");
  }

  let declaredLength: number | null;
  try {
    declaredLength = parseContentLength(
      response.headers.get("content-length"),
    );
  } catch (error) {
    await cancelBody(response);
    throw error;
  }
  if (declaredLength !== null && declaredLength > maxBytes) {
    await cancelBody(response);
    throw new FixedJsonTransportError("provider_response_too_large");
  }

  const { bytes, sha256 } = await readBoundedBody(
    response,
    maxBytes,
    options.signal,
  );
  let json: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    json = JSON.parse(text) as unknown;
  } catch {
    throw new FixedJsonTransportError("provider_json_invalid");
  }

  return {
    json,
    observation: {
      request_url: redactQueryValues(requestUrl),
      final_url: redactQueryValues(responseUrl),
      status: response.status,
      media_type: mediaType,
      bytes: bytes.byteLength,
      sha256,
      boundary_codes: [
        ...(options.boundary_codes ?? []),
      ],
    },
  };
}

export function redactProviderQueryValues(input: string | URL): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new FixedJsonTransportError("provider_request_invalid");
  }
  return redactQueryValues(url);
}

function normalizeExpectedOrigin(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new FixedJsonTransportError("provider_request_invalid");
  }
  if (
    url.protocol !== "https:"
    || url.username !== ""
    || url.password !== ""
    || url.pathname !== "/"
    || url.search !== ""
    || url.hash !== ""
    || (url.port !== "" && url.port !== "443")
  ) {
    throw new FixedJsonTransportError("provider_request_invalid");
  }
  return url.origin;
}

function normalizeRequestUrl(
  input: string | URL,
  expectedOrigin: string,
): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new FixedJsonTransportError("provider_request_invalid");
  }
  if (
    url.origin !== expectedOrigin
    || url.protocol !== "https:"
    || url.username !== ""
    || url.password !== ""
    || url.hash !== ""
    || (url.port !== "" && url.port !== "443")
  ) {
    throw new FixedJsonTransportError("provider_request_invalid");
  }
  return url;
}

function normalizeResponseUrl(responseUrl: string, requestUrl: URL): URL {
  if (responseUrl === "") return new URL(requestUrl);
  let parsed: URL;
  try {
    parsed = new URL(responseUrl);
  } catch {
    throw new FixedJsonTransportError("provider_redirect");
  }
  if (parsed.href !== requestUrl.href) {
    throw new FixedJsonTransportError("provider_redirect");
  }
  return parsed;
}

function normalizeMaxBytes(input: number | undefined): number {
  const value = input ?? DEFAULT_PROVIDER_MAX_RESPONSE_BYTES;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new FixedJsonTransportError("provider_request_invalid");
  }
  return value;
}

function isAbortSignal(input: unknown): input is AbortSignal {
  return (
    typeof input === "object"
    && input !== null
    && "aborted" in input
    && typeof input.aborted === "boolean"
    && "addEventListener" in input
    && typeof input.addEventListener === "function"
    && "removeEventListener" in input
    && typeof input.removeEventListener === "function"
  );
}

function parseJsonMediaType(input: string | null): string | null {
  if (input === null) return null;
  const mediaType = input.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (
    mediaType !== "application/json"
    && !/^application\/[a-z0-9!#$&^_.+-]+\+json$/u.test(mediaType)
  ) {
    return null;
  }
  return mediaType;
}

function parseContentLength(input: string | null): number | null {
  if (input === null) return null;
  const normalized = input.trim();
  if (!/^(0|[1-9]\d*)$/u.test(normalized)) {
    throw new FixedJsonTransportError("provider_content_length_invalid");
  }
  const value = Number(normalized);
  if (!Number.isSafeInteger(value)) {
    throw new FixedJsonTransportError("provider_content_length_invalid");
  }
  return value;
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<{ bytes: Uint8Array; sha256: string }> {
  if (response.body === null) {
    throw new FixedJsonTransportError("provider_body_unavailable");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  const hash = createHash("sha256");
  let total = 0;
  try {
    while (true) {
      const part = await readWithAbort(reader, signal);
      if (part.done) break;
      if (!(part.value instanceof Uint8Array)) {
        throw new FixedJsonTransportError("provider_body_read_failed");
      }
      total += part.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new FixedJsonTransportError("provider_response_too_large");
      }
      hash.update(part.value);
      chunks.push(part.value);
    }
  } catch (error) {
    if (error instanceof FixedJsonTransportError) throw error;
    throw new FixedJsonTransportError(
      signal.aborted ? "provider_aborted" : "provider_body_read_failed",
    );
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, sha256: hash.digest("hex") };
}

function readWithAbort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): ReturnType<ReadableStreamDefaultReader<Uint8Array>["read"]> {
  if (signal.aborted) {
    void reader.cancel();
    return Promise.reject(
      new FixedJsonTransportError("provider_aborted"),
    );
  }

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      void reader.cancel();
      reject(new FixedJsonTransportError("provider_aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    reader.read().then(
      (result) => {
        signal.removeEventListener("abort", onAbort);
        resolve(result);
      },
      () => {
        signal.removeEventListener("abort", onAbort);
        reject(
          new FixedJsonTransportError(
            signal.aborted
              ? "provider_aborted"
              : "provider_body_read_failed",
          ),
        );
      },
    );
  });
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Cancellation is best effort and never replaces the stable primary error.
  }
}

function redactQueryValues(input: URL): string {
  const redacted = new URL(input);
  const entries = [...redacted.searchParams.entries()];
  redacted.search = "";
  for (const [key] of entries) {
    redacted.searchParams.append(key, "[redacted]");
  }
  return redacted.toString();
}
