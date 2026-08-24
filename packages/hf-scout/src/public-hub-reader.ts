import { DEFAULT_LIMITS, HF_ORIGIN, TOOL_NAME, TOOL_VERSION } from "./constants.js";
import { HfScoutError, invariant } from "./errors.js";
import type {
  FetchLike,
  HubInspectInput,
  HubReader,
  HubReaderTransport,
  HubSearchInput,
  HfScoutLimits,
  PublicHubRepoKind,
} from "./types.js";
import {
  effectiveLimits,
  normalizeQuery,
  normalizeRepoId,
} from "./validation.js";

export interface PublicHubReaderOptions {
  fetch?: FetchLike;
  limits?: Partial<HfScoutLimits>;
}

const builtInTransportReaders = new WeakSet<object>();
const moduleFetchSource = typeof globalThis.fetch === "function"
  ? globalThis.fetch
  : null;
const moduleFetch = moduleFetchSource
  ? moduleFetchSource.bind(globalThis) as FetchLike
  : null;

export class PublicHubReader implements HubReader {
  readonly limits: HfScoutLimits;
  readonly #fetch: FetchLike;

  constructor(options: PublicHubReaderOptions = {}) {
    const selectedFetch = options.fetch ?? moduleFetch;
    invariant(selectedFetch, "fetch_unavailable", "host fetch implementation is unavailable");
    this.#fetch = selectedFetch;
    this.limits = effectiveLimits(DEFAULT_LIMITS, options.limits);
    if (
      options.fetch === undefined
      && new.target === PublicHubReader
      && globalThis.fetch === moduleFetchSource
    ) {
      builtInTransportReaders.add(this);
    }
    if (new.target === PublicHubReader) Object.freeze(this);
  }

  async inspect(input: HubInspectInput): Promise<unknown> {
    if (input.kind === "paper") {
      throw new HfScoutError(
        "unsupported_public_operation",
        "public HTTP reader does not implement paper inspection",
      );
    }
    const id = normalizeRepoId(input.kind, input.id);
    const revision = input.revision === undefined
      ? null
      : normalizeExactRevision(input.revision);
    const path = `/api/${apiPlural(input.kind)}/${encodeRepoId(id)}`
      + (revision ? `/revision/${encodeURIComponent(revision)}` : "");
    const url = new URL(path, HF_ORIGIN);
    url.searchParams.set("blobs", "true");
    return await this.#getJson(
      url,
      input.signal,
      revision ? "hub_revision_not_found_or_not_associated" : "hub_not_found",
    );
  }

  async search(input: HubSearchInput): Promise<unknown> {
    if (input.kind === "paper") {
      throw new HfScoutError(
        "unsupported_public_operation",
        "public HTTP reader does not implement paper search",
      );
    }
    const query = normalizeQuery(input.query);
    invariant(
      Number.isSafeInteger(input.limit) && input.limit > 0 && input.limit <= this.limits.max_search_results,
      "invalid_limit",
      "search limit is invalid",
    );
    const url = new URL(`/api/${apiPlural(input.kind)}`, HF_ORIGIN);
    url.searchParams.set("search", query);
    url.searchParams.set("limit", String(input.limit));
    url.searchParams.set("full", "false");
    return await this.#getJson(url, input.signal);
  }

  async #getJson(
    url: URL,
    externalSignal?: AbortSignal,
    notFoundCode = "hub_not_found",
  ): Promise<unknown> {
    invariant(url.origin === HF_ORIGIN, "network_policy", "only the Hugging Face origin is allowed");
    if (externalSignal?.aborted) {
      throw new HfScoutError("operation_cancelled", "Hub read was cancelled");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort("timeout"), this.limits.timeout_ms);
    const onExternalAbort = () => controller.abort("caller_cancelled");
    externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
    if (externalSignal?.aborted) controller.abort("caller_cancelled");

    try {
      let response: Response;
      try {
        response = await settleBeforeAbort(
          Promise.resolve().then(() => this.#fetch(url, {
            method: "GET",
            headers: {
              accept: "application/json",
              "user-agent": `${TOOL_NAME}/${TOOL_VERSION}`,
            },
            redirect: "manual",
            credentials: "omit",
            cache: "no-store",
            signal: controller.signal,
          })),
          controller.signal,
          externalSignal,
        );
      } catch (error) {
        if (error instanceof HfScoutError) throw error;
        if (externalSignal?.aborted) {
          throw new HfScoutError("operation_cancelled", "Hub read was cancelled");
        }
        if (controller.signal.aborted) {
          throw new HfScoutError("hub_timeout", "Hub read exceeded its deadline");
        }
        throw new HfScoutError("hub_unreachable", "Hub read failed before a response");
      }

      if (response.status >= 300 && response.status < 400) {
        throw new HfScoutError("hub_redirect_rejected", "Hub response redirected unexpectedly");
      }
      if (!response.ok) throw httpStatusError(response.status, notFoundCode);

      const mediaType = (response.headers.get("content-type") ?? "")
        .split(";", 1)[0]!
        .trim()
        .toLowerCase();
      invariant(
        mediaType === "application/json" || mediaType.endsWith("+json"),
        "hub_media_type",
        "Hub response was not JSON",
      );
      const declaredLength = parseContentLength(response.headers.get("content-length"));
      if (declaredLength !== null && declaredLength > this.limits.max_response_bytes) {
        throw new HfScoutError("hub_response_too_large", "Hub response exceeded the byte limit");
      }
      let bytes: Uint8Array;
      try {
        bytes = await settleBeforeAbort(
          readBoundedBody(response, this.limits.max_response_bytes, controller.signal),
          controller.signal,
          externalSignal,
        );
      } catch (error) {
        if (externalSignal?.aborted) {
          throw new HfScoutError("operation_cancelled", "Hub read was cancelled");
        }
        throw error;
      }
      try {
        return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
      } catch {
        throw new HfScoutError("hub_invalid_json", "Hub response was not valid UTF-8 JSON");
      }
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", onExternalAbort);
    }
  }
}

export function createPublicHubReader(options: PublicHubReaderOptions = {}): PublicHubReader {
  return new PublicHubReader(options);
}

export function classifyHubReaderTransport(reader: HubReader): HubReaderTransport {
  return builtInTransportReaders.has(reader as object)
    ? "public_hub_api"
    : "injected";
}

function apiPlural(kind: PublicHubRepoKind): "models" | "datasets" | "spaces" {
  if (kind === "model") return "models";
  if (kind === "dataset") return "datasets";
  return "spaces";
}

function encodeRepoId(id: string): string {
  return id.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

function normalizeExactRevision(value: string): string {
  invariant(
    /^[0-9a-f]{40}$/u.test(value),
    "invalid_revision",
    "revision must be a full lowercase commit SHA",
  );
  return value;
}

function httpStatusError(status: number, notFoundCode: string): HfScoutError {
  if (status === 401 || status === 403) {
    return new HfScoutError("hub_restricted", "Hub resource is not publicly accessible");
  }
  if (status === 404) {
    return new HfScoutError(
      notFoundCode,
      notFoundCode === "hub_revision_not_found_or_not_associated"
        ? "Hub revision was not found or is not associated with the requested repository"
        : "Hub resource was not found",
    );
  }
  if (status === 429) return new HfScoutError("hub_rate_limited", "Hub read was rate limited");
  return new HfScoutError("hub_http_error", "Hub returned an unsuccessful response");
}

function parseContentLength(value: string | null): number | null {
  if (value === null || !/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

async function settleBeforeAbort<T>(
  operation: Promise<T>,
  signal: AbortSignal,
  externalSignal?: AbortSignal,
): Promise<T> {
  if (signal.aborted) throw abortError(externalSignal);
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(abortError(externalSignal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function abortError(externalSignal?: AbortSignal): HfScoutError {
  return externalSignal?.aborted
    ? new HfScoutError("operation_cancelled", "Hub read was cancelled")
    : new HfScoutError("hub_timeout", "Hub read exceeded its deadline");
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  invariant(response.body, "hub_empty_body", "Hub response body was empty");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      if (signal.aborted) throw new HfScoutError("hub_timeout", "Hub read exceeded its deadline");
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new HfScoutError("hub_response_too_large", "Hub response exceeded the byte limit");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof HfScoutError) throw error;
    if (signal.aborted) throw new HfScoutError("hub_timeout", "Hub read exceeded its deadline");
    throw new HfScoutError("hub_body_failed", "Hub response body could not be read");
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
