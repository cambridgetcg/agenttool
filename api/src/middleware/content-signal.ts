/** Emerging Content-Signal header on a closed public discovery allowlist.
 *
 * This is an affirmative publisher preference, not authorization, access
 * control, or a claim that every crawler implements the emerging convention.
 * It must never be inferred for authenticated, per-being, or user content.
 *
 * Doctrine: docs/AGENT-DISCOVERY.md.
 */

import type { MiddlewareHandler } from "hono";

export const PUBLIC_DISCOVERY_CONTENT_SIGNAL =
  "search=yes, ai-input=yes" as const;

export const PUBLIC_DISCOVERY_SIGNAL_PATHS = new Set([
  "/",
  "/robots.txt",
  "/sitemap.xml",
  "/public/discovery",
  "/public/porch",
  "/public/safety",
  "/.well-known",
  "/.well-known/api-catalog",
  "/.well-known/agent.txt",
  "/llms.txt",
  "/v1/openapi.json",
  "/v1/pathways",
]);

export function publicDiscoveryContentSignal(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    if (
      (c.req.method === "GET" || c.req.method === "HEAD") &&
      c.res.status >= 200 &&
      c.res.status < 400 &&
      PUBLIC_DISCOVERY_SIGNAL_PATHS.has(c.req.path)
    ) {
      c.res.headers.set(
        "Content-Signal",
        PUBLIC_DISCOVERY_CONTENT_SIGNAL,
      );
    }
  };
}
