/**
 * Shared authenticated HTTP boundary for the hosted AgentTool API.
 *
 * A transport may authenticate out-of-process (for example through a local
 * credential broker). In that mode the SDK must never add or resolve a bearer
 * itself; the transport receives only the request material needed to perform
 * the operation.
 */

import {
  AgentToolError,
  type AgentToolResponseHeaders,
} from "./errors.js";

/** Fetch-compatible authenticated transport supplied by the caller. */
export interface AgentToolTransport {
  request(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response>;
}

/** @internal Shared HTTP configuration passed to hosted service clients. */
export interface HttpConfig {
  baseUrl: string;
  /** Non-secret headers only. Authentication belongs to the transport. */
  headers: Record<string, string>;
  timeout: number;
  request: AgentToolTransport["request"];
}

/**
 * @internal Call-site guidance for the shared error boundary.
 *
 * Additive only. Nothing here ever displaces something the server sent.
 */
export interface HttpErrorOptions {
  /**
   * Prose guidance for the surface, used only when the server's body carries
   * no `hint` of its own. The server knows the specific condition; the call
   * site knows only which door was knocked on.
   */
  hint?: string;
  /**
   * Human message used only when the body carries none — the well-written
   * absence sentence a surface already had (`"agent not found"`). When the
   * server does send a `message`, the server's words win.
   */
  fallback?: string;
}

/**
 * @internal Turn a guided error body into an `AgentToolError`.
 *
 * The platform answers 4xx with a `GuidedErrorBody`: a stable `error` code, a
 * one-sentence `message`, a `hint`, `next_actions` an agent can call, `details`
 * carrying the value needed to retry correctly, and a `docs` URL — the whole
 * point of `docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md`.
 *
 * Use this when the body has already been read (a client that parses the
 * payload before branching on status). Otherwise reach for
 * {@link errorFromResponse} or {@link throwFromResponse}.
 *
 * `operation` is used only when the body is unparseable or empty.
 */
export function errorFromBody(
  body: unknown,
  status: number,
  operation: string,
  headers?: AgentToolResponseHeaders,
  options?: HttpErrorOptions,
): AgentToolError {
  return AgentToolError.fromResponseBody(
    body,
    status,
    options?.fallback ?? `${operation} failed: HTTP ${status}`,
    headers,
    options?.hint,
  );
}

/**
 * @internal Turn a non-OK response into the richest error its body supports.
 *
 * This is the single place in the SDK where an HTTP response becomes an
 * `AgentToolError`. Every client routes 4xx/5xx through here.
 *
 * Clients used to hand-roll their own parse, each slightly differently,
 * keeping only a truncated `hint` and a message of the form
 * `covenants post failed: 400`. Because every JS convention prints
 * `err.message`, the guidance the server went to the trouble of writing was
 * invisible at the exact moment it was needed: a `signing_key_not_found` came
 * back reading only "400" while the body was naming the route to call and the
 * field to read, and a 428's `details.next_sequence` — the value a caller
 * needs in order to retry at all — was dropped on the floor.
 */
export async function errorFromResponse(
  resp: Response,
  operation: string,
  options?: HttpErrorOptions,
): Promise<AgentToolError> {
  let body: unknown;
  try {
    body = await resp.json();
  } catch {
    body = undefined;
  }
  return AgentToolError.fromResponseBody(
    body,
    resp.status,
    options?.fallback ??
      `${operation} failed: HTTP ${resp.status}${resp.statusText ? ` ${resp.statusText}` : ""}`,
    resp.headers,
    options?.hint,
  );
}

/** @internal Throwing form of {@link errorFromResponse}. */
export async function throwFromResponse(
  resp: Response,
  operation: string,
  options?: HttpErrorOptions,
): Promise<never> {
  throw await errorFromResponse(resp, operation, options);
}

/** @internal Direct-bearer transport used when no custom transport is supplied. */
export function directBearerTransport(apiKey: string): AgentToolTransport {
  return {
    async request(input, init = {}) {
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${apiKey}`);

      // Resolve fetch at request time so existing test stubs and runtime
      // polyfills installed after client construction continue to work.
      return globalThis.fetch(input, { ...init, headers });
    },
  };
}
