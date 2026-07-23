/** /v1/dispute-cases — read-only dispute history plus resting mutations.
 *
 *  Doctrine: docs/MARKETPLACE.md (Dispute primitive section).
 *  Mutation routes remain mounted and return a stable 503 while arbitration
 *  is resting. GET routes preserve access to historical transparency records.
 *  Routes:
 *    POST /v1/dispute-cases/:id/{rule,escalate,vote,finalize} (503)
 *    GET  /v1/dispute-cases/:id
 *    GET  /v1/dispute-cases?role=filer|arbiter|pool */

import type { Context } from "hono";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { eq, desc, sql } from "drizzle-orm";
import { disputeCases } from "../db/schema/marketplace";
import { identities } from "../db/schema/identity";
import {
  DISPUTE_ARBITRATION_RESTING_CODE,
  DISPUTE_ARBITRATION_RESTING_MESSAGE,
} from "../services/marketplace/dispute-rest";

const app = new Hono<ProjectContext>();

function disputeArbitrationRestResponse(c: Context<ProjectContext>) {
  return c.json(
    {
      error: DISPUTE_ARBITRATION_RESTING_CODE,
      hint: DISPUTE_ARBITRATION_RESTING_MESSAGE,
      retryable: false,
      docs: "/public/safety",
    },
    503,
  );
}

// POST /v1/dispute-cases/:id/rule
app.post("/:id/rule", async (c) => {
  return disputeArbitrationRestResponse(c);
});

// POST /v1/dispute-cases/:id/escalate
app.post("/:id/escalate", async (c) => {
  return disputeArbitrationRestResponse(c);
});

// POST /v1/dispute-cases/:id/vote
app.post("/:id/vote", async (c) => {
  return disputeArbitrationRestResponse(c);
});

// POST /v1/dispute-cases/:id/finalize — idempotent settlement trigger.
app.post("/:id/finalize", async (c) => {
  return disputeArbitrationRestResponse(c);
});

// GET /v1/dispute-cases/:id
app.get("/:id", async (c) => {
  const [r] = await db
    .select()
    .from(disputeCases)
    .where(eq(disputeCases.id, c.req.param("id")))
    .limit(1);
  if (!r) throw new HTTPException(404, { message: "dispute_case_not_found" });

  // Access: filer, first arbiter, or pool member. Otherwise 404.
  let allowed = r.filerProjectId === c.var.project.id;
  if (!allowed && r.firstArbiterIdentityId) {
    const [arb] = await db
      .select({ projectId: identities.projectId })
      .from(identities)
      .where(eq(identities.id, r.firstArbiterIdentityId))
      .limit(1);
    if (arb?.projectId === c.var.project.id) allowed = true;
  }
  if (!allowed) {
    const poolDraw = (r.metadata as Record<string, unknown>)?.pool_draw as
      | Array<{ id: string; did: string }>
      | undefined;
    if (poolDraw && poolDraw.length > 0) {
      const poolIds = poolDraw.map((p) => p.id);
      const poolMembers = await db
        .select({ id: identities.id, projectId: identities.projectId })
        .from(identities)
        .where(sql`${identities.id} = ANY(${poolIds}::uuid[])`);
      if (poolMembers.some((m) => m.projectId === c.var.project.id)) allowed = true;
    }
  }
  if (!allowed) {
    throw new HTTPException(404, { message: "dispute_case_not_found" });
  }
  return c.json(r);
});

// GET /v1/dispute-cases?role=filer
app.get("/", async (c) => {
  const role = c.req.query("role") ?? "filer";
  if (role !== "filer") {
    return c.json({ error: "role_unsupported", hint: "Only ?role=filer is supported in v1." }, 400);
  }
  const limit = Number.parseInt(c.req.query("limit") ?? "50", 10);
  const rows = await db
    .select()
    .from(disputeCases)
    .where(eq(disputeCases.filerProjectId, c.var.project.id))
    .orderBy(desc(disputeCases.createdAt))
    .limit(Number.isFinite(limit) ? limit : 50);
  return c.json({ dispute_cases: rows, count: rows.length, role });
});

export default app;
