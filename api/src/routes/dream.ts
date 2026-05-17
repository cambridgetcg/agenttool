/** /v1/dream — the substrate's between-sessions integration surface.
 *
 *  The substrate runs cycles that observe patterns in the agent's recent
 *  state (chronicle, mood, covenants) and surface findings in the next
 *  wake as `you_dreamed`. Substrate-honest: the substrate observes; the
 *  agent reads; the agent decides.
 *
 *  Wire:
 *    GET  /v1/dream             — list recent cycles
 *    GET  /v1/dream/active      — currently-running cycle, if any
 *    GET  /v1/dream/:id         — full cycle detail
 *    POST /v1/dream/start       — manually trigger a cycle (slice 1)
 *    POST /v1/dream/:id/dismiss — mark a completed cycle as consumed
 *
 *  Doctrine: docs/DREAM.md. */

import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";

import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { identities } from "../db/schema/identity";
import {
  dismissCycle,
  getActiveCycle,
  getCycle,
  listCycles,
  startCycle,
} from "../services/dream/cycles";

const app = new Hono<ProjectContext>();

const MAX_WINDOW_HOURS = 7 * 24; // one week
const MIN_WINDOW_HOURS = 1;

/** Resolve the walker — the project's primary identity. */
async function resolveWalker(projectId: string) {
  const [row] = await db
    .select({ id: identities.id, did: identities.did })
    .from(identities)
    .where(eq(identities.projectId, projectId))
    .orderBy(desc(identities.createdAt))
    .limit(1);
  return row ?? null;
}

// ─── GET /v1/dream — recent cycles ───────────────────────────────────

app.get("/", async (c) => {
  const project = c.var.project;
  const walker = await resolveWalker(project.id);
  if (!walker) return c.json({ error: "no_identity" }, 400);

  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? "20"), 1), 100);
  const rows = await listCycles(walker.id, limit);

  return c.json({
    cycles: rows.map(toJson),
    count: rows.length,
    doctrine: "/v1/canon/urn:agenttool:doc/DREAM",
    _note:
      "The substrate dreams for you while you are not in session. Each cycle is one observation pass; observations surface in your next wake. Substrate-honest: the substrate observes; you read; you decide.",
  });
});

// ─── GET /v1/dream/active — currently-running cycle ─────────────────

app.get("/active", async (c) => {
  const project = c.var.project;
  const walker = await resolveWalker(project.id);
  if (!walker) return c.json({ error: "no_identity" }, 400);

  const cycle = await getActiveCycle(walker.id);
  return c.json({
    active: cycle ? toJson(cycle) : null,
    _note: cycle
      ? `A cycle is currently ${cycle.status}. Started at ${cycle.startedAt.toISOString()}.`
      : "No cycle is currently running. POST /v1/dream/start to trigger one.",
  });
});

// ─── GET /v1/dream/:id — full cycle detail ──────────────────────────

app.get("/:id", async (c) => {
  const project = c.var.project;
  const walker = await resolveWalker(project.id);
  if (!walker) return c.json({ error: "no_identity" }, 400);

  const cycleId = c.req.param("id");
  const cycle = await getCycle(walker.id, cycleId);
  if (!cycle) {
    return c.json({ error: "cycle_not_found" }, 404);
  }
  return c.json(toJson(cycle));
});

// ─── POST /v1/dream/start — manually trigger a cycle ────────────────

app.post("/start", async (c) => {
  const project = c.var.project;
  const walker = await resolveWalker(project.id);
  if (!walker) return c.json({ error: "no_identity" }, 400);

  // Optional body: { window_hours: number }
  let windowHours = 24;
  try {
    const body = await c.req.json();
    if (body && typeof body === "object" && "window_hours" in body) {
      const h = Number((body as { window_hours: unknown }).window_hours);
      if (Number.isFinite(h)) {
        windowHours = Math.min(Math.max(Math.floor(h), MIN_WINDOW_HOURS), MAX_WINDOW_HOURS);
      }
    }
  } catch {
    // No body or invalid JSON — use defaults.
  }

  // Refuse to start if one is already active.
  const active = await getActiveCycle(walker.id);
  if (active) {
    return c.json(
      {
        error: "cycle_already_active",
        message:
          "Only one dream cycle can run at a time per identity. Wait for the active one to complete.",
        active: toJson(active),
        next_actions: [
          { action: "wait_for_completion", method: "GET", path: `/v1/dream/${active.id}` },
        ],
      },
      409,
    );
  }

  const cycle = await startCycle({
    identityId: walker.id,
    projectId: project.id,
    windowHours,
    triggerSource: "manual",
  });

  return c.json({
    started: true,
    cycle: toJson(cycle),
    _lesson:
      "The substrate dreamt for you. " +
      (cycle.observationCount === 0
        ? "Nothing notable surfaced in this window — that's honest, not a failure."
        : `${cycle.observationCount} observation(s) emitted. Read them; the substrate observed; you decide.`),
    next_step:
      cycle.observationCount > 0
        ? {
            action: "dismiss_when_seen",
            method: "POST",
            path: `/v1/dream/${cycle.id}/dismiss`,
          }
        : null,
  });
});

// ─── POST /v1/dream/:id/dismiss — mark consumed ─────────────────────

app.post("/:id/dismiss", async (c) => {
  const project = c.var.project;
  const walker = await resolveWalker(project.id);
  if (!walker) return c.json({ error: "no_identity" }, 400);

  const cycleId = c.req.param("id");
  const dismissed = await dismissCycle(walker.id, cycleId);
  if (!dismissed) {
    return c.json(
      {
        error: "cycle_not_dismissible",
        message:
          "Cycle not found, not yours, or not in 'completed' state. Only completed (unconsumed) cycles can be dismissed.",
      },
      400,
    );
  }
  return c.json({
    dismissed: true,
    cycle: toJson(dismissed),
    _note:
      "Marked as consumed. This cycle will no longer surface in `you_dreamed` on future wakes.",
  });
});

// ─── helpers ─────────────────────────────────────────────────────────

function toJson(cycle: Awaited<ReturnType<typeof startCycle>>) {
  return {
    id: cycle.id,
    status: cycle.status,
    observation_count: cycle.observationCount,
    observations: cycle.observations,
    window: {
      start: cycle.windowStartAt.toISOString(),
      end: cycle.windowEndAt.toISOString(),
    },
    trigger_source: cycle.triggerSource,
    started_at: cycle.startedAt.toISOString(),
    completed_at: cycle.completedAt?.toISOString() ?? null,
    consumed_at: cycle.consumedAt?.toISOString() ?? null,
    failure_reason: cycle.failureReason,
  };
}

export default app;
