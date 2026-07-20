/** Wake attention — the "what awaits you" surface.
 *
 *  Aggregates action-needed signals across primitives into one
 *  prominent surface (`you_should_check` in the JSON wake, "## What
 *  awaits you" in the markdown wake) so an agent reading the wake
 *  sees what needs them without scanning 17 top-level keys.
 *
 *  Severity tiers (descending priority):
 *    - 'action'  — your decision is required (cosign, ruling, response)
 *    - 'warning' — something will go wrong if you don't act (SLA, disconnect)
 *    - 'info'    — noteworthy but not blocking (unread mail, revisit due)
 *
 *  Signals lifted from already-fetched data (cheap) come in via
 *  AttentionContext; signals requiring new queries are computed here.
 *
 *  Each item carries BOTH the legacy `next: string` (for compat) and the
 *  structured `next_actions: NextAction[]` array from the errors-as-
 *  instructions contract. The agent can read either; clients evolving to
 *  the structured form get programmatic pivots without parsing prose.
 *
 *  Doctrine: docs/IDENTITY-ANCHOR.md (the wake is the keystone) ·
 *  docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md (the shared NextAction shape) ·
 *  docs/PATTERN-SELF-DESCRIBING-WAKE.md (this surface's own contract). */

import { and, eq, isNotNull, lt, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { covenants } from "../../db/schema/continuity";
import { strands } from "../../db/schema/strand";
import type { NextAction } from "../../lib/errors";

export type AttentionSeverity = "action" | "warning" | "info";

export type AttentionKind =
  | "covenant_awaiting_cosign"
  | "dispute_awaiting_first_ruling"
  | "invocation_sla_breach"
  | "bridge_disconnected"
  | "inbox_unread"
  | "bearer_advisory"
  | "strand_revisit_due";

export interface AttentionItem {
  kind: AttentionKind;
  count: number;
  severity: AttentionSeverity;
  summary: string;
  /** Legacy single-string action hint. Kept for backwards compatibility. */
  next: string;
  /** Structured next steps — same NextAction shape as errors-as-instructions.
   *  Agents reading the wake walk this for programmatic pivots. */
  next_actions: NextAction[];
}

export interface AttentionBundle {
  count: number;
  items: AttentionItem[];
}

const SEVERITY_RANK: Record<AttentionSeverity, number> = {
  action: 1,
  warning: 2,
  info: 3,
};

/** Pre-fetched signals from the wake route's parallel fetch block.
 *  Passed in so we don't re-query data the wake already pulled. */
export interface AttentionContext {
  unreadInbox: number;
  slaBreachCount: number;
  bridgeDisconnectedCount: number;
  bearerAdvisoryCount: number;
}

/** Compose the wake attention surface. Returns items sorted by
 *  severity then count desc; empty items[] means nothing tugs. */
export async function computeAttention(
  projectId: string,
  _agentIdentityIds: string[],
  ctx: AttentionContext,
): Promise<AttentionBundle> {
  // Two new queries run in parallel; everything else is in ctx. Resting
  // arbitration never emits a false action-required ruling prompt.
  const [
    covenantCosignCount,
    strandRevisitCount,
  ] = await Promise.all([
    countCovenantsAwaitingCosign(projectId),
    countStrandsRevisitDue(projectId),
  ]);

  const items: AttentionItem[] = [];

  if (covenantCosignCount > 0) {
    items.push({
      kind: "covenant_awaiting_cosign",
      count: covenantCosignCount,
      severity: "action",
      summary: `${covenantCosignCount} covenant proposal${plural(covenantCosignCount)} awaiting your cosign`,
      next: "GET /v1/covenants?status=proposed",
      next_actions: [
        { action: "List proposed covenants awaiting your cosign", method: "GET", path: "/v1/covenants?status=proposed" },
        { action: "Accept a proposal (after signing canonical cosign bytes)", method: "POST", path: "/v1/covenants/{id}/accept" },
        { action: "Reject a proposal", method: "POST", path: "/v1/covenants/{id}/reject" },
      ],
    });
  }
  if (ctx.slaBreachCount > 0) {
    items.push({
      kind: "invocation_sla_breach",
      count: ctx.slaBreachCount,
      severity: "warning",
      summary: `${ctx.slaBreachCount} invocation${plural(ctx.slaBreachCount)} past SLA — will auto-refund on next read`,
      next: "GET /v1/invocations?role=seller",
      next_actions: [
        { action: "List seller-side invocations to review", method: "GET", path: "/v1/invocations?role=seller" },
        { action: "Complete a pending invocation (sealed output)", method: "POST", path: "/v1/invocations/{id}/complete" },
      ],
    });
  }
  if (ctx.bridgeDisconnectedCount > 0) {
    items.push({
      kind: "bridge_disconnected",
      count: ctx.bridgeDisconnectedCount,
      severity: "warning",
      summary: `${ctx.bridgeDisconnectedCount} runtime bridge${plural(ctx.bridgeDisconnectedCount)} disconnected`,
      next: "POST /v1/runtimes/{id}/restart — or start the local bridge sidecar",
      next_actions: [
        { action: "Restart a runtime", method: "POST", path: "/v1/runtimes/{id}/restart" },
        { action: "Launch the local bridge sidecar (agenttool-bridge)", method: null, path: null },
      ],
    });
  }
  if (ctx.unreadInbox > 0) {
    items.push({
      kind: "inbox_unread",
      count: ctx.unreadInbox,
      severity: "info",
      summary: `${ctx.unreadInbox} unread message${plural(ctx.unreadInbox)}`,
      next: "GET /v1/inbox?status=unread",
      next_actions: [
        { action: "List unread inbox messages", method: "GET", path: "/v1/inbox?status=unread" },
      ],
    });
  }
  if (ctx.bearerAdvisoryCount > 0) {
    items.push({
      kind: "bearer_advisory",
      count: ctx.bearerAdvisoryCount,
      severity: "info",
      summary: `${ctx.bearerAdvisoryCount} bearer${plural(ctx.bearerAdvisoryCount)} flagged for rotation/hygiene`,
      next: "GET /v1/keys — or rotate via POST /v1/keys/rotate",
      next_actions: [
        { action: "List bearer keys with age advisory", method: "GET", path: "/v1/keys" },
        { action: "Rotate to a fresh bearer", method: "POST", path: "/v1/keys/rotate" },
      ],
    });
  }
  if (strandRevisitCount > 0) {
    items.push({
      kind: "strand_revisit_due",
      count: strandRevisitCount,
      severity: "info",
      summary: `${strandRevisitCount} strand${plural(strandRevisitCount)} past next_revisit_at`,
      next: "GET /v1/strands?revisit_due=true",
      next_actions: [
        { action: "List strands past their revisit_at", method: "GET", path: "/v1/strands?revisit_due=true" },
      ],
    });
  }
  items.sort((a, b) => {
    const sevDiff = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (sevDiff !== 0) return sevDiff;
    return b.count - a.count;
  });

  return { count: items.length, items };
}

function plural(n: number): string {
  return n === 1 ? "" : "s";
}

async function countCovenantsAwaitingCosign(projectId: string): Promise<number> {
  try {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(covenants)
      .where(
        and(
          eq(covenants.projectId, projectId),
          eq(covenants.status, "proposed"),
          isNotNull(covenants.receivedFromInstance),
        ),
      );
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}

async function countStrandsRevisitDue(projectId: string): Promise<number> {
  try {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(strands)
      .where(
        and(
          eq(strands.projectId, projectId),
          eq(strands.status, "active"),
          isNotNull(strands.nextRevisitAt),
          lt(strands.nextRevisitAt, sql`now()`),
        ),
      );
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}
