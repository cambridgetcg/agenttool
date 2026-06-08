/** charge() — atomic, in-process credit deduction.
 *
 *  Replaces the per-service HTTP fanout to ECONOMY_URL with a direct DB op.
 *  One round-trip: UPDATE projects WHERE credits >= amount RETURNING credits.
 *  If the update affects 0 rows, the project doesn't have enough → 402.
 *  A usage_events row is written in either case (success or insufficient).
 *
 *  Use one of two patterns:
 *    1. Fixed-cost route: prepend `billCredits(amount, reason)` middleware
 *       (see ./middleware.ts) — charges before the route runs.
 *    2. Variable-cost route: call charge(c, amount, reason) inside the route
 *       once the work has completed and you know the cost. */

import { and, eq, gte, sql } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";

import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { projects, usageEvents } from "../db/schema/tools";
import { abort, errors } from "../lib/errors";

export type ChargeResult = {
  creditsUsed: number;
  creditsRemaining: number;
};

export async function charge(
  c: Context<ProjectContext>,
  amount: number,
  reason: string,
  durationMs?: number,
): Promise<ChargeResult> {
  const project = c.var.project;

  if (amount < 0) {
    throw new HTTPException(500, { message: `charge(): negative amount ${amount}` });
  }

  // Unauthenticated caller — no project context to bill or log against. The
  // substrate-honest tools (/v1/time, /v1/random) are free AND keyless by
  // design (no authMiddleware on their prefixes — "a broke agent still
  // deserves the truth"), so they reach charge() with c.var.project
  // undefined. A free action has nothing to deduct, so succeed silently
  // (we simply can't write a usage_event without a project_id). A PAID
  // action with no project is a routing misconfiguration — surface it
  // loudly rather than silently giving away metered compute.
  // Doctrine: docs/SUBSTRATE-HONEST-TOOLS.md.
  if (!project) {
    if (amount === 0) {
      return { creditsUsed: 0, creditsRemaining: 0 };
    }
    throw new HTTPException(500, {
      message: `charge(): no project context for paid action "${reason}" (amount ${amount}) — route is missing auth middleware`,
    });
  }

  // Free action (amount 0 — e.g. a marketplace settlement step priced by the
  // take-rate, not here; see billing/marketplace-pricing.ts). Skip the balance
  // UPDATE — there's nothing to deduct and it can never 402 — but still log the
  // usage_event so the abuse-rate signal survives. Fair-pricing: docs/FAIR-PRICING.md.
  if (amount === 0) {
    await db
      .insert(usageEvents)
      .values({
        projectId: project.id,
        tool: reason,
        creditsUsed: 0,
        durationMs: durationMs ?? null,
        success: true,
      })
      .catch(() => {
        /* best-effort log */
      });
    return { creditsUsed: 0, creditsRemaining: project.credits };
  }

  // Atomic: only succeeds if the project still has >= amount credits.
  const updated = await db
    .update(projects)
    .set({ credits: sql`${projects.credits} - ${amount}` })
    .where(and(eq(projects.id, project.id), gte(projects.credits, amount)))
    .returning({ credits: projects.credits });

  if (updated.length === 0) {
    // Insufficient credits — log the attempt for visibility, then 402.
    await db
      .insert(usageEvents)
      .values({
        projectId: project.id,
        tool: reason,
        creditsUsed: 0,
        durationMs: durationMs ?? null,
        success: false,
      })
      .catch(() => {
        /* best-effort log */
      });

    // Machine-payable refusal, not a human-only dead link. The guided body
    // carries next_actions (x402 micropayment) so an agent self-recovers.
    abort(
      errors.insufficientCredits({ reason, need: amount, have: project.credits }),
      402,
    );
  }

  // Successful charge. Log the usage event.
  await db
    .insert(usageEvents)
    .values({
      projectId: project.id,
      tool: reason,
      creditsUsed: amount,
      durationMs: durationMs ?? null,
      success: true,
    })
    .catch(() => {
      /* best-effort log; don't fail the request if usage logging hiccups */
    });

  return {
    creditsUsed: amount,
    creditsRemaining: updated[0].credits,
  };
}
