/** Browser-visible response headers for the public API surface.
 *
 * CORS preflight permission to *send* a payment header does not let browser
 * JavaScript read the resulting challenge, settlement receipt, or balance.
 * Keep those machine-recovery headers explicitly exposed.
 */

import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";

import { welcomeHeaderForPath } from "./welcome";

export const API_CORS_EXPOSED_HEADERS = [
  "ETag",
  "PAYMENT-REQUIRED",
  "PAYMENT-RESPONSE",
  "Link",
  "Link-Template",
  "Retry-After",
  "X-Cache-Eligible",
  "X-Credits-Balance",
  "X-Idempotency-Supported",
  "X-Idempotency-Skipped",
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
    allowHeaders: ["If-None-Match"],
    exposeHeaders: [...API_CORS_EXPOSED_HEADERS],
    maxAge: 86_400,
  });

  return async (c, next) => {
    const path = new URL(c.req.url, "http://_").pathname;
    const isReadOnlyDiscovery =
      path === "/.well-known/webfinger" ||
      path === "/feeds" ||
      path.startsWith("/feeds/");
    const response = await (isReadOnlyDiscovery
      ? readOnlyDiscoveryCors
      : corsMiddleware)(c, next);

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
