/** Credit-balance headers on selected authenticated prefixes.
 *
 *  Despite the historical filename, this middleware does not enforce a
 *  request rate. It uses values already loaded by authMiddleware.
 *
 *  Headers emitted:
 *    X-Credits-Balance       Wallet credit balance (Ring 2 substrate credits)
 *    X-Idempotency-Supported Optional marker for a route family with
 *                              durable resource-ID replay anchors. Generic
 *                              Idempotency-Key support is advertised by the
 *                              separate idempotency middleware.
 *
 *  No X-Plan / tier header — agenttool does not have per-agent subscription
 *  tiers. Doctrine: docs/BUSINESS-MODEL.md (Ring 2 metered + Ring 3 take-rate;
 *  never per-agent monthly fees). */

import type { MiddlewareHandler } from "hono";

import type { ProjectContext } from "../auth/middleware";

export const rateLimitHeaders = (options?: {
  idempotencyMarker?: string;
}): MiddlewareHandler<ProjectContext> => {
  return async (c, next) => {
    await next();
    const project = c.var.project;
    if (!project) return;

    const balance = (project as unknown as { credits?: number }).credits;
    if (typeof balance === "number") {
      c.res.headers.set("X-Credits-Balance", String(balance));
    }
    if (options?.idempotencyMarker) {
      c.res.headers.set("X-Idempotency-Supported", options.idempotencyMarker);
    }
  };
};
