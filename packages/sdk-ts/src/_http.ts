/**
 * Shared authenticated HTTP boundary for the hosted AgentTool API.
 *
 * A transport may authenticate out-of-process (for example through a local
 * credential broker). In that mode the SDK must never add or resolve a bearer
 * itself; the transport receives only the request material needed to perform
 * the operation.
 */

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
 * @internal Turn a non-OK response into the richest error its body supports.
 *
 * The platform answers 4xx with a `GuidedErrorBody`: a stable `error` code, a
 * one-sentence `message`, a `hint`, `next_actions` an agent can call, and a
 * `docs` URL — the whole point of `docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md`.
 *
 * Several clients used to hand-roll their own parse, keeping only a truncated
 * `hint` and a message of the form `covenants post failed: 400`. Because every
 * JS convention prints `err.message`, the guidance the server went to the
 * trouble of writing was invisible at the exact moment it was needed: a
 * `signing_key_not_found` came back reading only "400", while the body was
 * naming the route to call and the field to read.
 *
 * `AgentToolError.fromResponseBody` already knew how to do this properly. This
 * is the one call site the clients share so nobody re-invents the lossy one.
 *
 * `operation` is used only when the body is unparseable or empty.
 */
export async function throwFromResponse(
  resp: Response,
  operation: string,
): Promise<never> {
  const { AgentToolError } = await import("./errors.js");
  let body: unknown;
  try {
    body = await resp.json();
  } catch {
    body = undefined;
  }
  throw AgentToolError.fromResponseBody(
    body,
    resp.status,
    `${operation} failed: HTTP ${resp.status}${resp.statusText ? ` ${resp.statusText}` : ""}`,
    resp.headers,
  );
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
