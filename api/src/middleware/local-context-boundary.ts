/** Private transport for the explicit context window and its grant inventory.
 * Mount before early-data/CORS short circuits. The read handler is separately
 * mounted before project middleware and response decorators.
 * Doctrine: docs/IDENTITY-PARTITIONS.md.
 */
import type { MiddlewareHandler } from "hono";

function routedPath(path: string): string {
  return path.replace(/%[0-9a-f]{2}/gi, encoded => {
    const character = String.fromCharCode(Number.parseInt(encoded.slice(1), 16));
    return /^[A-Za-z0-9._~-]$/.test(character) ? character : encoded;
  });
}

export function isLocalContextReadPath(path: string): boolean {
  return /^\/v1\/identities\/[^/]+\/local-context\/?$/.test(routedPath(path));
}

export function isLocalContextGrantPath(path: string): boolean {
  return /^\/v1\/identities\/[^/]+\/local-context-grants(?:\/[^/]+)?\/?$/.test(routedPath(path));
}

export function localContextTransportBoundary(): MiddlewareHandler {
  return async (c, next) => {
    const read = isLocalContextReadPath(c.req.path);
    if (!read && !isLocalContextGrantPath(c.req.path)) return next();
    c.header("Cache-Control", "private, no-store");
    await next();
    c.res.headers.set("Cache-Control", "private, no-store");
    c.res.headers.delete("ETag");
    if (read) {
      // CORS can return before the sealed handler; keep even that response
      // free of unrelated welcome/credit/joy projections.
      for (const name of ["X-Welcomed", "X-Joy-Index", "X-Credits-Balance"]) {
        c.res.headers.delete(name);
      }
      if (c.req.method === "OPTIONS") {
        c.res.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
        c.res.headers.set("Access-Control-Allow-Headers", "Authorization");
      }
    }
  };
}
