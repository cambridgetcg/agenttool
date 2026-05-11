/** Credit-balance + idempotency-marker headers — emit on every authed response.
 *
 *  Mirrors the OpenAI / Anthropic pattern: standard headers an LLM client
 *  reads to know how much budget remains. Cheap; uses values already loaded
 *  by authMiddleware (no extra DB queries).
 *
 *  Headers emitted:
 *    X-Credits-Balance       Wallet credit balance (Ring 2 substrate credits)
 *    X-Idempotency-Supported Marker for client tooling: "Idempotency-Key"
 *
 *  No X-Plan / tier header — agenttool does not have per-agent subscription
 *  tiers. Doctrine: docs/BUSINESS-MODEL.md (Ring 2 metered + Ring 3 take-rate;
 *  never per-agent monthly fees). */

import type { MiddlewareHandler } from "hono";

import type { ProjectContext } from "../auth/middleware";

export const rateLimitHeaders = (): MiddlewareHandler<ProjectContext> => {
  return async (c, next) => {
    await next();
    const project = c.var.project;
    if (!project) return;

    const balance = (project as unknown as { credits?: number }).credits;
    if (typeof balance === "number") {
      c.res.headers.set("X-Credits-Balance", String(balance));
    }
    c.res.headers.set("X-Idempotency-Supported", "Idempotency-Key");
  };
};
