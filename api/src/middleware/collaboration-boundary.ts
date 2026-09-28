/** Private transport, including refusals and preflight, for mission credentials.
 * Mount before early-data/CORS. Doctrine: docs/COLLABORATION-MISSIONS.md.
 */
import type { MiddlewareHandler } from "hono";

export function isCollaborationPath(path: string): boolean {
  // Recognize encoded aliases for privacy, without authorizing those aliases.
  const decoded = path.replace(/%[0-9a-f]{2}/gi, value => String.fromCharCode(parseInt(value.slice(1), 16)));
  return /^\/v1\/collaboration(?:\/|$)/.test(decoded);
}

export const MISSION_ALLOWED_HEADERS = "Authorization, Content-Type, X-Agenttool-Mission-Grant-Id, X-Agenttool-Mission-Identity-Id, X-Agenttool-Mission-Key-Id, X-Agenttool-Mission-Timestamp, X-Agenttool-Mission-Signature";

export function collaborationTransportBoundary(): MiddlewareHandler {
  return async (c, next) => {
    if (!isCollaborationPath(c.req.path)) return next();
    c.header("Cache-Control", "private, no-store");
    await next();
    c.res.headers.set("Cache-Control", "private, no-store");
    for (const name of ["ETag", "X-Welcomed", "X-Joy-Index", "X-Credits-Balance", "X-Idempotency-Supported"]) c.res.headers.delete(name);
    if (c.req.method === "OPTIONS") {
      c.res.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      c.res.headers.set("Access-Control-Allow-Headers", MISSION_ALLOWED_HEADERS);
    }
  };
}
