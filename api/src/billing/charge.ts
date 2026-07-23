/** charge() — atomic, in-process credit deduction.
 *
 *  Replaces the per-service HTTP fanout to ECONOMY_URL with a direct DB op.
 *  One round-trip: UPDATE projects WHERE credits >= amount RETURNING credits.
 *  If the update affects 0 rows, the project doesn't have enough → 402.
 *  A usage_events row is written in either case (success or insufficient).
 *
 *  Use one of three patterns:
 *    1. Fixed-cost route: prepend `billCredits(amount, reason)` middleware
 *       (see ./middleware.ts) — charges before the route runs.
 *    2. Variable-cost route: call charge(c, amount, reason) inside the route
 *       once the work has completed and you know the cost.
 *    3. Fixed-cost bounded attempt: call reserveCharge() before work and
 *       finalizeChargeSuccess() only after successful completion. */

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

/** A debit plus its failure-default usage row.
 *
 * The row starts with success=false. If the process, transport, or parser
 * fails after reservation, the debit and failed attempt remain visible. A
 * successful caller flips this exact row with finalizeChargeSuccess(). */
export type ChargeReservation = ChargeResult & {
  usageEventId: string | null;
  projectId: string | null;
};

/** Update surface shared by the root Drizzle client and open transactions. */
export type ChargeFinalizeDatabase = Pick<typeof db, "update">;

const POSTGRES_INTEGER_MAX = 2_147_483_647;

function assertValidAmount(operation: string, amount: number): void {
  if (
    !Number.isSafeInteger(amount) ||
    amount < 0 ||
    amount > POSTGRES_INTEGER_MAX
  ) {
    throw new HTTPException(500, {
      message: `${operation}(): invalid credit amount ${amount}`,
    });
  }
}

function updateContextCredits(
  c: Context<ProjectContext>,
  credits: number,
): void {
  const project = c.var.project;
  if (!project || project.credits === credits) return;
  // rateLimitHeaders() runs after the handler and reads c.var.project. Keep
  // that snapshot current so X-Credits-Balance reports the post-debit value.
  c.set("project", { ...project, credits });
}

/**
 * Non-mutating balance advisory retained for existing callers.
 *
 * This snapshot check is not a reservation and must not guard metered work on
 * its own. Fixed-cost routes that need an atomic pre-work debit use
 * reserveCharge().
 */
export function assertCanCharge(
  c: Context<ProjectContext>,
  amount: number,
  reason: string,
): void {
  const project = c.var.project;
  assertValidAmount("assertCanCharge", amount);
  if (!project) {
    if (amount === 0) return;
    throw new HTTPException(500, {
      message:
        `assertCanCharge(): no project context for paid action "${reason}" ` +
        `(amount ${amount}) — route is missing auth middleware`,
    });
  }
  if (project.credits < amount) {
    abort(
      errors.insufficientCredits({
        reason,
        need: amount,
        have: project.credits,
      }),
      402,
    );
  }
}

/**
 * Atomically reserve a fixed-cost operation before any metered work starts.
 *
 * The project debit and failure-default usage row share one transaction: an
 * insert failure rolls the debit back, while concurrent reservations cannot
 * spend the same credits because the UPDATE retains charge()'s credits >=
 * amount predicate. Failed work intentionally keeps the debit and false row.
 */
export async function reserveCharge(
  c: Context<ProjectContext>,
  amount: number,
  reason: string,
  database: typeof db = db,
): Promise<ChargeReservation> {
  const project = c.var.project;
  assertValidAmount("reserveCharge", amount);
  if (!project) {
    if (amount === 0) {
      return {
        creditsUsed: 0,
        creditsRemaining: 0,
        usageEventId: null,
        projectId: null,
      };
    }
    throw new HTTPException(500, {
      message:
        `reserveCharge(): no project context for paid action "${reason}" ` +
        `(amount ${amount}) — route is missing auth middleware`,
    });
  }

  const reserved = await database.transaction(async (tx) => {
    let creditsRemaining = project.credits;
    if (amount > 0) {
      const [updated] = await tx
        .update(projects)
        .set({ credits: sql`${projects.credits} - ${amount}` })
        .where(and(eq(projects.id, project.id), gte(projects.credits, amount)))
        .returning({ credits: projects.credits });
      if (!updated) {
        const [current] = await tx
          .select({ credits: projects.credits })
          .from(projects)
          .where(eq(projects.id, project.id))
          .limit(1);
        return {
          kind: "insufficient" as const,
          creditsRemaining: current?.credits ?? 0,
        };
      }
      creditsRemaining = updated.credits;
    }

    const [event] = await tx
      .insert(usageEvents)
      .values({
        projectId: project.id,
        tool: reason,
        creditsUsed: amount,
        durationMs: null,
        success: false,
      })
      .returning({ id: usageEvents.id });
    if (!event) {
      throw new Error("reserveCharge(): usage event insert returned no row");
    }
    return {
      kind: "reserved" as const,
      creditsRemaining,
      usageEventId: event.id,
    };
  });

  if (reserved.kind === "insufficient") {
    updateContextCredits(c, reserved.creditsRemaining);
    // No debit occurred. Retain charge()'s best-effort insufficient-attempt
    // witness without making the 402 depend on audit availability.
    await database
      .insert(usageEvents)
      .values({
        projectId: project.id,
        tool: reason,
        creditsUsed: 0,
        durationMs: null,
        success: false,
      })
      .catch(() => {
        /* best-effort log */
      });
    abort(
      errors.insufficientCredits({
        reason,
        need: amount,
        have: reserved.creditsRemaining,
      }),
      402,
    );
  }

  updateContextCredits(c, reserved.creditsRemaining);
  return {
    creditsUsed: amount,
    creditsRemaining: reserved.creditsRemaining,
    usageEventId: reserved.usageEventId,
    projectId: project.id,
  };
}

/** Mark a reserved attempt successful after its work and parsing complete. */
export async function finalizeChargeSuccess(
  reservation: ChargeReservation,
  durationMs: number,
  database: ChargeFinalizeDatabase = db,
): Promise<void> {
  if (reservation.usageEventId === null || reservation.projectId === null) {
    return;
  }
  if (!Number.isSafeInteger(durationMs) || durationMs < 0) {
    throw new HTTPException(500, {
      message: `finalizeChargeSuccess(): invalid duration ${durationMs}`,
    });
  }

  const [updated] = await database
    .update(usageEvents)
    .set({ success: true, durationMs })
    .where(
      and(
        eq(usageEvents.id, reservation.usageEventId),
        eq(usageEvents.projectId, reservation.projectId),
      ),
    )
    .returning({ id: usageEvents.id });
  if (!updated) {
    throw new HTTPException(500, {
      message: "finalizeChargeSuccess(): reservation usage event not found",
    });
  }
}

export async function charge(
  c: Context<ProjectContext>,
  amount: number,
  reason: string,
  durationMs?: number,
): Promise<ChargeResult> {
  const project = c.var.project;
  assertValidAmount("charge", amount);

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
    const [current] = await db
      .select({ credits: projects.credits })
      .from(projects)
      .where(eq(projects.id, project.id))
      .limit(1);
    const currentCredits = current?.credits ?? 0;
    updateContextCredits(c, currentCredits);
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
      errors.insufficientCredits({ reason, need: amount, have: currentCredits }),
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

  updateContextCredits(c, updated[0].credits);
  return {
    creditsUsed: amount,
    creditsRemaining: updated[0].credits,
  };
}
