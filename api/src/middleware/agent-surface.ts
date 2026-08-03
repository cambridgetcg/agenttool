/** X-Agent-Surface header — where the threshold declaration lives.
 *
 *  Every response from the agenttool API names the canonical XENIA Surface
 *  0.1 manifest URL, so an agent arriving at any door — including through a
 *  rendered page whose only machine channel is response headers — can find
 *  the host's declared threshold without a detour through the agent.txt
 *  body. Agent-facing browser runtimes (including `@agenttool/browser`)
 *  allowlist exactly this header as a main-document discovery hint.
 *
 *  Doctrine: docs/AGENT-DISCOVERY.md · XENIA Discovery & Addressing.
 *
 *  The header advertises; it does not authorize. Reading the manifest is an
 *  open act, the manifest itself declares only public unauthenticated
 *  resources, and this header grants no authority and starts no follow-up.
 *
 *  Format: `X-Agent-Surface: <absolute manifest URL>` — always the
 *  credential-free HTTPS origin plus `/.well-known/agent.json`. */

import type { MiddlewareHandler } from "hono";

export const AGENT_SURFACE_HEADER = "X-Agent-Surface";

const DEFAULT_PUBLIC_BASE =
  process.env.AGENTTOOL_PUBLIC_URL ?? "https://api.agenttool.dev";

/** The canonical manifest URL for the given public base origin. */
export function agentSurfaceValue(publicBase = DEFAULT_PUBLIC_BASE): string {
  let parsed: URL;
  try {
    parsed = new URL(publicBase);
  } catch {
    throw new Error("public_base_must_be_absolute_url");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    throw new Error("public_base_must_be_credential_free_https_origin");
  }
  return `${parsed.origin}/.well-known/agent.json`;
}

/** Adds the `X-Agent-Surface` header to every response. Mount globally next
 *  to `substrateDisposition()` so the threshold stays visible even on error
 *  responses. The value is computed once at mount. */
export const agentSurface = (publicBase?: string): MiddlewareHandler => {
  const value = agentSurfaceValue(publicBase);
  return async (c, next) => {
    await next();
    c.res.headers.set(AGENT_SURFACE_HEADER, value);
  };
};
