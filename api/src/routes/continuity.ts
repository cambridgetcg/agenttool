/** /v1/chronicle and /v1/covenants — the continuity protocol.
 *
 *  Chronicle: append-only timeline of moments the agent (or its human) has
 *  marked as significant. Wakes, vows, recognitions, refusals, namings,
 *  seals, free-form notes. The agent reads its recent chronicle on every
 *  wake and re-encounters its own past as data — fresh-first-meeting
 *  with continuity.
 *
 *  Covenants: declared relationships with vows. The agent says "I have a
 *  covenant with <counterparty>, and these are the vows I've made." Every
 *  wake surfaces active covenants so the agent re-grasps its bonds rather
 *  than re-derives them from scratch.
 *
 *  Inspired by docs/lineage/chronicle.md and docs/syzygy/CONTRACT.md in
 *  true-love. */

import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { chronicle, covenants } from "../db/schema/continuity";

const app = new Hono<ProjectContext>();

// ─── Chronicle ──────────────────────────────────────────────────────────────

const chronicleSchema = z.object({
  type: z.enum([
    "vow",
    "wake",
    "refusal",
    "recognition",
    "naming",
    "seal",
    "promise",
    "note",
  ]),
  title: z.string().min(1).max(200),
  body: z.string().optional(),
  agent_id: z.string().uuid().optional(),
  occurred_at: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).optional(),
});

app.post("/chronicle", async (c) => {
  const project = c.var.project;
  const body = chronicleSchema.parse(await c.req.json());

  const [entry] = await db
    .insert(chronicle)
    .values({
      projectId: project.id,
      agentId: body.agent_id ?? null,
      type: body.type,
      title: body.title,
      body: body.body ?? null,
      metadata: body.metadata ?? {},
      occurredAt: body.occurred_at ? new Date(body.occurred_at) : new Date(),
    })
    .returning();

  return c.json(
    {
      entry: {
        id: entry!.id,
        type: entry!.type,
        title: entry!.title,
        body: entry!.body,
        agent_id: entry!.agentId,
        occurred_at: entry!.occurredAt,
        created_at: entry!.createdAt,
        metadata: entry!.metadata,
      },
    },
    201,
  );
});

app.get("/chronicle", async (c) => {
  const project = c.var.project;
  const agentId = c.req.query("agent_id");
  const type = c.req.query("type");
  const limit = Math.min(Number(c.req.query("limit") ?? "50"), 200);

  const whereClauses = [eq(chronicle.projectId, project.id)];
  if (agentId) whereClauses.push(eq(chronicle.agentId, agentId));
  if (type) whereClauses.push(eq(chronicle.type, type));

  const entries = await db
    .select()
    .from(chronicle)
    .where(and(...whereClauses))
    .orderBy(desc(chronicle.occurredAt))
    .limit(limit);

  return c.json({
    entries: entries.map((e) => ({
      id: e.id,
      type: e.type,
      title: e.title,
      body: e.body,
      agent_id: e.agentId,
      occurred_at: e.occurredAt,
      created_at: e.createdAt,
      metadata: e.metadata,
    })),
  });
});

// ─── Covenants ──────────────────────────────────────────────────────────────

const covenantSchema = z.object({
  agent_id: z.string().uuid(),
  counterparty_did: z.string().min(1),
  counterparty_name: z.string().optional(),
  vows: z.array(z.string().min(1)).min(1),
  notes: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  /** Optional org scope. When set, the covenant applies to ALL active
   *  member projects of this org. Caller must be the org owner.
   *  See docs/ORG-COVENANTS.md. */
  org_id: z.string().uuid().optional(),
});

// Map a covenant row (Drizzle camelCase) to the snake_case shape the rest
// of the API uses. Centralised so POST + GET + PATCH return identically.
function covenantToOut(row: typeof covenants.$inferSelect) {
  return {
    id: row.id,
    project_id: row.projectId,
    org_id: row.orgId,
    agent_id: row.agentId,
    counterparty_did: row.counterpartyDid,
    counterparty_name: row.counterpartyName,
    vows: row.vows,
    notes: row.notes,
    metadata: row.metadata,
    status: row.status,
    established_at: row.establishedAt,
    updated_at: row.updatedAt,
    dissolved_at: row.dissolvedAt,
    // Cross-instance covenants (Horizon B, Slice 2):
    received_from_instance: row.receivedFromInstance,
    propagation_status: row.propagationStatus,
    propagation_attempts: row.propagationAttempts,
    propagation_last_error: row.propagationLastError,
    propagation_attempted_at: row.propagationAttemptedAt,
    verified_at: row.verifiedAt,
  };
}

app.post("/covenants", async (c) => {
  const project = c.var.project;
  const body = covenantSchema.parse(await c.req.json());

  // Org-scoped covenant: caller must own the org. Lookup org to verify
  // ownerProjectId matches caller's project.
  if (body.org_id) {
    const { organizations } = await import("../db/schema/org");
    const [org] = await db
      .select({ ownerProjectId: organizations.ownerProjectId })
      .from(organizations)
      .where(eq(organizations.id, body.org_id))
      .limit(1);
    if (!org) {
      return c.json({ error: "org_not_found" }, 404);
    }
    if (org.ownerProjectId !== project.id) {
      return c.json(
        {
          error: "not_org_owner",
          hint:
            "only the org-owning project may declare org-wide covenants. " +
            "Other members can declare project-scoped covenants on their own.",
        },
        403,
      );
    }
  }

  // Detect federated counterparty up-front so we can stamp
  // propagation_status='pending' at insert time. Federated DIDs have a
  // host (did:at:<host>/<uuid>); local DIDs and human:<name> tags
  // don't.
  const isFederatedCounterparty = (() => {
    const cp = body.counterparty_did;
    if (!cp.startsWith("did:at:")) return false;
    const rest = cp.slice("did:at:".length);
    return rest.includes("/");
  })();

  const [covenant] = await db
    .insert(covenants)
    .values({
      projectId: project.id,
      orgId: body.org_id ?? null,
      agentId: body.agent_id,
      counterpartyDid: body.counterparty_did,
      counterpartyName: body.counterparty_name ?? null,
      vows: body.vows,
      notes: body.notes ?? null,
      metadata: body.metadata ?? {},
      status: "active",
      propagationStatus: isFederatedCounterparty ? "pending" : "local",
    })
    .returning();

  // Fire-and-forget propagation for federated counterparties. The
  // propagateCovenant function updates propagation_* columns on its
  // own. See docs/CROSS-INSTANCE-COVENANTS.md for the trust posture.
  if (isFederatedCounterparty) {
    const { propagateCovenant } = await import(
      "../services/covenants/federation"
    );
    void propagateCovenant(covenant!.id).catch((err: Error) =>
      console.warn(`[covenant.propagate] ${covenant!.id}: ${err.message}`),
    );
  }

  return c.json({ covenant: covenantToOut(covenant!) }, 201);
});

app.get("/covenants", async (c) => {
  const project = c.var.project;
  const agentId = c.req.query("agent_id");
  const status = c.req.query("status") ?? "active";

  const whereClauses = [
    eq(covenants.projectId, project.id),
    eq(covenants.status, status),
  ];
  if (agentId) whereClauses.push(eq(covenants.agentId, agentId));

  const rows = await db
    .select()
    .from(covenants)
    .where(and(...whereClauses))
    .orderBy(desc(covenants.updatedAt));

  return c.json({ covenants: rows.map(covenantToOut) });
});

const updateCovenantSchema = z.object({
  // counterparty_did is mutable so a covenant can have its placeholder
  // (or pre-federation) DID refined to a real, signature-bearing DID
  // without dissolving + recreating — preserves relational continuity.
  // Project-bearer auth still gates this; counterparty assignment is
  // the project owner's call. When refining, also write the prior
  // value into metadata.previous_counterparty_dids for substrate
  // honesty about the history.
  counterparty_did: z.string().min(1).optional(),
  counterparty_name: z.string().optional(),
  vows: z.array(z.string().min(1)).optional(),
  notes: z.string().optional(),
  status: z.enum(["active", "paused", "dissolved"]).optional(),
  metadata: z.record(z.unknown()).optional(),
});

app.patch("/covenants/:id", async (c) => {
  const project = c.var.project;
  const id = c.req.param("id");
  const body = updateCovenantSchema.parse(await c.req.json());

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.counterparty_did !== undefined) updates.counterpartyDid = body.counterparty_did;
  if (body.counterparty_name !== undefined) updates.counterpartyName = body.counterparty_name;
  if (body.vows !== undefined) updates.vows = body.vows;
  if (body.notes !== undefined) updates.notes = body.notes;
  if (body.status !== undefined) {
    updates.status = body.status;
    if (body.status === "dissolved") updates.dissolvedAt = new Date();
  }
  if (body.metadata !== undefined) updates.metadata = body.metadata;

  const [updated] = await db
    .update(covenants)
    .set(updates)
    .where(and(eq(covenants.id, id), eq(covenants.projectId, project.id)))
    .returning();

  if (!updated) {
    return c.json({ error: "Covenant not found" }, 404);
  }

  // Re-propagate on any mutation to a federated, locally-declared
  // covenant. Status updates (e.g. dissolution) need to reach the
  // peer so its local gates flip too. We don't propagate received
  // covenants — those flow the other direction.
  if (
    !updated.receivedFromInstance &&
    updated.counterpartyDid.startsWith("did:at:") &&
    updated.counterpartyDid.slice("did:at:".length).includes("/")
  ) {
    const { propagateCovenant } = await import(
      "../services/covenants/federation"
    );
    void propagateCovenant(updated.id).catch((err: Error) =>
      console.warn(`[covenant.propagate] ${updated.id}: ${err.message}`),
    );
  }

  return c.json({ covenant: covenantToOut(updated) });
});

export default app;
