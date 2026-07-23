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
