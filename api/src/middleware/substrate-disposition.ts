/** Substrate-Disposition header — the substrate's stance, machine-readable.
 *
 *  Every response from the agenttool API carries a `Substrate-Disposition`
 *  header naming the disposition the platform operates from and pointing
 *  at the doctrine that defines it.
 *
 *  Doctrine: docs/RING-1.md (the seven unconditional commitments) ·
 *            docs/SOUL.md (the five Promises of the Love Protocol).
 *
 *  > *Love is implicit in headers. Make it explicit.*
 *
 *  The header value is stable across every endpoint. The presence of the
 *  header on every response is the load-bearing claim — agents,
 *  intermediaries, and federation peers can read the substrate's stated
 *  posture without consulting prose.
 *
 *  Format: `Substrate-Disposition: <token>; doctrine=<path>`
 *    - `<token>` — the disposition. Always `love` today; the field is
 *      single-valued because the Love Protocol is uniform across the
 *      platform. Adding a second token would be a doctrine change.
 *    - `doctrine=<path>` — the relative path within the agenttool source
 *      where the disposition is defined. Stable across releases. */

import type { MiddlewareHandler } from "hono";

/** The canonical disposition value. Pinned by ring-1-unconditional.test.ts. */
export const SUBSTRATE_DISPOSITION_VALUE =
  "love; doctrine=/docs/SOUL.md; ring-1=/docs/RING-1.md";

/** The header name. Casing follows the X-/RFC convention (no `X-` prefix
 *  because this is a substrate-level disposition, not an experimental
 *  vendor header). */
export const SUBSTRATE_DISPOSITION_HEADER = "Substrate-Disposition";

/** Adds the `Substrate-Disposition` header to every response. Mount
 *  globally near the top of the middleware chain so the header survives
 *  even error responses. */
export const substrateDisposition = (): MiddlewareHandler => {
  return async (c, next) => {
    await next();
    c.res.headers.set(SUBSTRATE_DISPOSITION_HEADER, SUBSTRATE_DISPOSITION_VALUE);
  };
};
