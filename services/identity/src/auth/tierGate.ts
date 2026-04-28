/**
 * Tier gate middleware — calls agent-economy /v1/billing/check before processing.
 * Returns 429 if the project's daily usage limit is exceeded.
 * Falls through silently if ECONOMY_URL is not set or the call fails (fail-open).
 */

import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { config } from "../config.ts";

export type Resource = "identity_ops" | "attestations" | "token_ops";

export interface CheckResult {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
  reset_at?: string;
  upgrade_url?: string;
}

export async function checkBillingLimit(
  projectId: string,
  resource: Resource,
): Promise<CheckResult | null> {
  if (!config.economyUrl) return null;

  try {
    const res = await fetch(`${config.economyUrl}/v1/billing/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: projectId, resource }),
      signal: AbortSignal.timeout(2000),
    });

    if (res.status === 429) {
      const body = (await res.json()) as CheckResult;
      return { ...body, allowed: false };
    }

    if (res.ok) {
      return (await res.json()) as CheckResult;
    }

    return null;
  } catch {
    return null;
  }
}

export function tierGate(resource: Resource) {
  return async (c: Context<{ Variables: { project: { id: string } } }>, next: Next) => {
    const project = c.get("project");
    if (!project?.id) return next();

    const result = await checkBillingLimit(project.id, resource);

    if (result && !result.allowed) {
      c.header("X-RateLimit-Limit", String(result.limit));
      c.header("X-RateLimit-Remaining", "0");
      if (result.reset_at) c.header("X-RateLimit-Reset", result.reset_at);
      throw new HTTPException(429, {
        message: JSON.stringify({
          error: "rate_limit",
          reset_at: result.reset_at,
          upgrade_url: result.upgrade_url ?? "https://app.agenttool.dev/billing",
        }),
      });
    }

    if (result) {
      c.header("X-RateLimit-Limit", String(result.limit === -1 ? "unlimited" : result.limit));
      c.header("X-RateLimit-Remaining", String(result.remaining === -1 ? "unlimited" : result.remaining));
    }

    return next();
  };
}
