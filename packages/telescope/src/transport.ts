import { createHash } from "node:crypto";

import { LimitError, NetworkPolicyError } from "./errors.js";
import { assertPublicHttpsUrl } from "./target.js";
import type {
  FetchLike,
  ProbeId,
  ResolveHostname,
  SourceObservation,
  TelescopeLimits,
} from "./types.js";

export interface FetchedDocument {
  observation: SourceObservation;
  body: Uint8Array | null;
}

export class ScanBudget {
  #requests = 0;
  #bytes = 0;

  constructor(readonly limits: TelescopeLimits) {}

  reserveRequest(): void {
    this.#requests += 1;
    if (this.#requests > this.limits.max_requests) {
      throw new LimitError(
        "request_budget_exhausted",
        "The scan request budget was exhausted.",
      );
    }
  }

  reserveBytes(bytes: number): void {
    this.#bytes += bytes;
    if (this.#bytes > this.limits.max_total_bytes) {
      throw new LimitError(
        "total_byte_budget_exhausted",
        "The scan aggregate byte budget was exhausted.",
      );
    }
  }
}

function reportSafeUrl(value: string): { value: string; redacted: boolean } {
  try {
    const url = new URL(value);
    const redacted = Boolean(
      url.username || url.password || url.search || url.hash,
    );
    url.username = "";
    url.password = "";
    if (url.search) url.search = "?redacted";
    url.hash = "";
    return url.href.length <= 2_048
      ? { value: url.href, redacted }
      : { value: "redacted:oversized-url", redacted: true };
  } catch {
    return { value: "redacted:invalid-url", redacted: true };
  }
}

function reportSafeRedirects(values: readonly string[]): {
  values: string[];
  redacted: boolean;
} {
  const safe = values.map(reportSafeUrl);
  return {
    values: safe.map(({ value }) => value),
    redacted: safe.some(({ redacted }) => redacted),
  };
}

function emptyObservation(
  id: ProbeId,
  url: string,
  state: SourceObservation["state"],
  errorCode: string,
): SourceObservation {
  const safeUrl = reportSafeUrl(url);
  return {
    id,
    url: safeUrl.value,
    url_redacted: safeUrl.redacted,
    state,
    status_code: null,
    final_url: null,
    final_url_redacted: false,
    redirect_chain: [],
    redirect_chain_redacted: false,
    media_type: null,
    bytes: null,
    sha256: null,
    error_code: errorCode,
  };
}

function mediaTypeOf(response: Response): string | null {
  const value = response.headers.get("content-type");
  const mediaType = value?.split(";", 1)[0]?.trim().toLowerCase() ?? null;
  return mediaType && mediaType.length <= 256 ? mediaType : null;
}

function isRedirectStatus(status: number): boolean {
  return [301, 302, 303, 307, 308].includes(status);
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The observation is already complete; cancellation is resource cleanup.
  }
}

async function readBoundedBody(
  response: Response,
  budget: ScanBudget,
  maxBytes: number,
): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsed = Number(declaredLength);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      throw new LimitError(
        "invalid_content_length",
        "The response declared an invalid Content-Length.",
      );
    }
    if (parsed > maxBytes) {
      throw new LimitError(
        "response_too_large",
        "The response exceeds the per-document byte limit.",
      );
    }
  }

  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        throw new LimitError(
          "response_too_large",
          "The response exceeds the per-document byte limit.",
        );
      }
      budget.reserveBytes(value.byteLength);
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }

  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function classifyThrown(error: unknown): {
  state: SourceObservation["state"];
  code: string;
} {
  if (error instanceof NetworkPolicyError) {
    return { state: "blocked", code: error.code };
  }
  if (error instanceof LimitError) {
    return {
      state:
        error.code.includes("byte") || error.code.includes("large")
          ? "too_large"
          : "blocked",
      code: error.code,
    };
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return { state: "unreachable", code: "aborted_or_timed_out" };
  }
  return { state: "unreachable", code: "network_failure" };
}

export async function fetchDocument(input: {
  id: ProbeId;
  url: string;
  accept: string;
  fetch: FetchLike;
  resolve_hostname: ResolveHostname;
  budget: ScanBudget;
  limits: TelescopeLimits;
  signal: AbortSignal;
}): Promise<FetchedDocument> {
  const redirectChain: string[] = [];
  let current = input.url;

  try {
    for (let redirects = 0; ; redirects += 1) {
      const url = await assertPublicHttpsUrl(
        current,
        input.resolve_hostname,
        input.signal,
      );
      input.budget.reserveRequest();

      const response = await input.fetch(url, {
        method: "GET",
        redirect: "manual",
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        headers: {
          accept: input.accept,
          "accept-encoding": "identity",
          "user-agent": "@agenttool/telescope/0.0.0-development",
        },
        signal: input.signal,
      });

      if (response.url) {
        const observedUrl = new URL(response.url);
        observedUrl.hash = "";
        const expectedUrl = new URL(url.href);
        expectedUrl.hash = "";
        if (observedUrl.href !== expectedUrl.href) {
          await discardBody(response);
          throw new NetworkPolicyError(
            "unexpected_followed_redirect",
            "The HTTP transport followed a redirect despite manual redirect mode.",
          );
        }
      }

      if (isRedirectStatus(response.status)) {
        const location = response.headers.get("location");
        await discardBody(response);
        if (!location) {
          const safeFinalUrl = reportSafeUrl(url.href);
          const safeRedirects = reportSafeRedirects(redirectChain);
          return {
            observation: {
              ...emptyObservation(
                input.id,
                input.url,
                "unreachable",
                "redirect_without_location",
              ),
              status_code: response.status,
              final_url: safeFinalUrl.value,
              final_url_redacted: safeFinalUrl.redacted,
              redirect_chain: safeRedirects.values,
              redirect_chain_redacted: safeRedirects.redacted,
            },
            body: null,
          };
        }
        if (redirects >= input.limits.max_redirects) {
          throw new LimitError(
            "redirect_limit_exhausted",
            "The redirect limit was exhausted.",
          );
        }
        const nextUrl = await assertPublicHttpsUrl(
          new URL(location, url),
          input.resolve_hostname,
          input.signal,
        );
        current = nextUrl.href;
        redirectChain.push(current);
        continue;
      }

      const safeInputUrl = reportSafeUrl(input.url);
      const safeFinalUrl = reportSafeUrl(url.href);
      const safeRedirects = reportSafeRedirects(redirectChain);
      const common = {
        id: input.id,
        url: safeInputUrl.value,
        url_redacted: safeInputUrl.redacted,
        status_code:
          response.status >= 100 && response.status <= 599
            ? response.status
            : null,
        final_url: safeFinalUrl.value,
        final_url_redacted: safeFinalUrl.redacted,
        redirect_chain: safeRedirects.values,
        redirect_chain_redacted: safeRedirects.redacted,
        media_type: mediaTypeOf(response),
      } as const;

      if (response.status === 404 || response.status === 410) {
        await discardBody(response);
        return {
          observation: {
            ...common,
            state: "not_found",
            bytes: null,
            sha256: null,
            error_code: null,
          },
          body: null,
        };
      }
      if (response.status === 401 || response.status === 403) {
        await discardBody(response);
        return {
          observation: {
            ...common,
            state: "restricted",
            bytes: null,
            sha256: null,
            error_code: null,
          },
          body: null,
        };
      }
      if (!response.ok) {
        await discardBody(response);
        return {
          observation: {
            ...common,
            state: "unreachable",
            bytes: null,
            sha256: null,
            error_code: "http_error",
          },
          body: null,
        };
      }

      const contentEncoding = response.headers.get("content-encoding");
      if (
        contentEncoding &&
        contentEncoding.trim().toLowerCase() !== "identity"
      ) {
        await discardBody(response);
        throw new NetworkPolicyError(
          "unexpected_content_encoding",
          "The server ignored the identity content-encoding boundary.",
        );
      }

      let body: Uint8Array;
      try {
        body = await readBoundedBody(
          response,
          input.budget,
          input.limits.max_response_bytes,
        );
      } catch (error) {
        await discardBody(response);
        throw error;
      }
      return {
        observation: {
          ...common,
          state: "present",
          bytes: body.byteLength,
          sha256: createHash("sha256").update(body).digest("hex"),
          error_code: null,
        },
        body,
      };
    }
  } catch (error) {
    const { state, code } = classifyThrown(error);
    const safeRedirects = reportSafeRedirects(redirectChain);
    return {
      observation: {
        ...emptyObservation(input.id, input.url, state, code),
        redirect_chain: safeRedirects.values,
        redirect_chain_redacted: safeRedirects.redacted,
      },
      body: null,
    };
  }
}
