/** Browser-visible response headers for the public API surface.
 *
 * CORS preflight permission to *send* a payment header does not let browser
 * JavaScript read the resulting challenge, settlement receipt, or balance.
 * Keep those machine-recovery headers explicitly exposed.
 */

import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";

import { isAllowedPublicMcpOrigin } from "../services/mcp/http-boundary";
import { welcomeHeaderForPath } from "./welcome";

export const API_CORS_EXPOSED_HEADERS = [
  "ETag",
  "PAYMENT-REQUIRED",
  "PAYMENT-RESPONSE",
  "Link",
  "Link-Template",
  "Retry-After",
  "X-Cache-Eligible",
  "X-Byte-Count",
  "X-Credits-Balance",
  "X-Idempotency-Supported",
  "X-Idempotency-Skipped",
  "X-Token-Cost",
  "X-Wake-Profile",
  "X-Variant",
  "X-Welcomed",
  "Idempotent-Replay",
] as const;

export function apiCors(): MiddlewareHandler {
  const corsMiddleware = cors({
    exposeHeaders: [...API_CORS_EXPOSED_HEADERS],
  });
  const readOnlyDiscoveryCors = cors({
    allowMethods: ["GET", "HEAD", "OPTIONS"],
    allowHeaders: ["If-None-Match", "X-Play", "X-Tutor"],
    exposeHeaders: [...API_CORS_EXPOSED_HEADERS],
    maxAge: 86_400,
  });
  const publicMcpCors = cors({
    origin: (origin) =>
      origin && isAllowedPublicMcpOrigin(origin) ? origin : null,
    allowMethods: ["POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "MCP-Protocol-Version"],
    exposeHeaders: [...API_CORS_EXPOSED_HEADERS],
    maxAge: 86_400,
  });

  return async (c, next) => {
    const path = new URL(c.req.url, "http://_").pathname;
    // Hono decodes percent-encoded unreserved characters while routing. Match
    // the same equivalent spelling without decoding `%2F` into a new path.
    const routedPath = path.replace(/%[0-9A-Fa-f]{2}/g, (encoded) => {
      const character = String.fromCharCode(
        Number.parseInt(encoded.slice(1), 16),
      );
      return /^[A-Za-z0-9._~-]$/.test(character) ? character : encoded;
    });
    const isPublicMcp = routedPath === "/v1/mcp";
    const isReadOnlyDiscovery =
      routedPath === "/" ||
      routedPath === "/health" ||
      routedPath === "/AGENTS.md" ||
      routedPath === "/llms.txt" ||
      routedPath === "/llms-full.txt" ||
      routedPath === "/openapi.json" ||
      routedPath === "/robots.txt" ||
      routedPath === "/sitemap.xml" ||
      routedPath === "/v1/openapi.json" ||
      routedPath === "/v1/pathways" ||
      routedPath === "/public/discovery" ||
      routedPath === "/public/discovery/" ||
      routedPath === "/public/porch" ||
      routedPath === "/public/safety" ||
      routedPath === "/.well-known" ||
      routedPath.startsWith("/.well-known/") ||
      routedPath === "/feeds" ||
      routedPath.startsWith("/feeds/");
    let response: Response | void;
    if (
      isPublicMcp &&
      !isAllowedPublicMcpOrigin(c.req.header("origin") ?? null)
    ) {
      // Do not let generic CORS short-circuit an invalid MCP Origin. The MCP
      // route returns its protocol-shaped 403 for both POST and preflight.
      await next();
      c.header("Vary", "Origin", { append: true });
      response = c.res;
    } else {
      response = await (isPublicMcp
        ? publicMcpCors
        : isReadOnlyDiscovery
          ? readOnlyDiscoveryCors
          : corsMiddleware)(c, next);
    }

    // Hono's CORS middleware answers a valid preflight immediately, before
    // downstream response framing runs. Preserve that short circuit while
    // still carrying the transport-level welcome promised on every response.
    const headers = response instanceof Response ? response.headers : c.res.headers;
    if (c.req.method === "OPTIONS" && !headers.has("X-Welcomed")) {
      headers.set("X-Welcomed", welcomeHeaderForPath(path));
    }

    return response;
  };
}
