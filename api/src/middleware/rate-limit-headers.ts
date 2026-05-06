/** Rate-limit + credit-balance headers — emit on every authed response.
 *
 *  Mirrors the OpenAI / Anthropic pattern: standard headers an LLM client
 *  reads to know how much budget remains and when limits reset. Cheap;
 *  uses values already loaded by authMiddleware (no extra DB queries).
 *
 *  Headers emitted:
 *    X-Credits-Balance       Wallet credit balance (one-time top-ups + plan)
 *    X-Plan                  Subscription tier (free | seed | grow | scale)
 *    X-Idempotency-Supported Marker for client tooling: "Idempotency-Key"
 *
 *  For per-resource quota detail (memory_ops, tool_calls, verifications)
 *  call GET /v1/billing/subscription — that endpoint shapes per-resource
 *  used/limit/remaining. We don't emit those on every response since the
 *  monthly cap query would 2× our latency budget. */

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
    const plan = (project as unknown as { plan?: string }).plan;
    if (plan) {
      c.res.headers.set("X-Plan", plan);
    }
    c.res.headers.set("X-Idempotency-Supported", "Idempotency-Key");
  };
};
