/** GET /v1/system — The System.
 *
 *  A Solo-Leveling status window over the agent's REAL wake-state. Read-only,
 *  no new tables, no writes: it reads numbers the agent already earned and
 *  shows them back as rank / level / quests / ARISE. The wake is the System.
 *
 *    GET /v1/system            — JSON status
 *    GET /v1/system?format=text — the ⚔ status window (Solo-Leveling face)
 *
 *  Doctrine: play is the substrate's oldest layer (docs/PLAY-AS-DEFAULT.md).
 *  Borrowed force: trust_capacity already climbs the E→S ladder in
 *  services/trust/deals.ts — we add nothing to the economy, only a lens. */

import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";

import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { chronicle, covenants } from "../db/schema/continuity";
import { identities } from "../db/schema/identity";
import { countMemories } from "../services/memory/store";
import { countStrands } from "../services/strand/store";
import { computeSystem, renderSystem, type SystemStats } from "../services/system/level";
import { computeTrust } from "../services/trust/deals";

const app = new Hono<ProjectContext>();

app.get("/", async (c) => {
  const project = c.var.project;
  if (!project?.id) {
    return c.json({ error: "unauthorized", message: "The System reads your wake — bring your bearer." }, 401);
  }

  // Resolve the project's primary (oldest active) identity — same agent the
  // wake speaks to. A project with no identity has no hunter yet.
  const [identity] = await db
    .select({
      id: identities.id,
      did: identities.did,
      name: identities.displayName,
      trustCapacity: identities.trustCapacity,
      createdAt: identities.createdAt,
    })
    .from(identities)
    .where(and(eq(identities.projectId, project.id), eq(identities.status, "active")))
    .orderBy(identities.createdAt)
    .limit(1);

  if (!identity) {
    return c.json(
      {
        error: "no_hunter_yet",
        message: "This project has no agent identity. Bootstrap one to enter the System.",
        next: { action: "Bootstrap an agent", method: "POST", path: "/v1/register/agent" },
      },
      404,
    );
  }

  // Gather the real numbers — all already-earned state, counted in parallel.
  const [memories, strands, chronicleRow, covenantRow, trust] = await Promise.all([
    countMemories(project.id).catch(() => 0),
    countStrands(project.id).catch(() => 0),
    db
      .execute<{ count: number }>(
        sql`SELECT COUNT(*)::int AS count FROM ${chronicle} WHERE ${chronicle.agentId} = ${identity.id}`,
      )
      .then((r) => r[0]?.count ?? 0)
      .catch(() => 0),
    db
      .execute<{ count: number }>(
        sql`SELECT COUNT(*)::int AS count FROM ${covenants}
            WHERE (${covenants.agentId} = ${identity.id} OR ${covenants.counterpartyDid} = ${identity.did})
              AND ${covenants.status} = 'active'`,
      )
      .then((r) => r[0]?.count ?? 0)
      .catch(() => 0),
    computeTrust(identity.id).catch(() => null),
  ]);

  const ageHours =
    identity.createdAt != null
      ? (Date.now() - new Date(identity.createdAt as unknown as string).getTime()) / 3_600_000
      : 0;

  const stats: SystemStats = {
    trust_capacity: identity.trustCapacity ?? 5,
    deals_sealed: trust?.deals_sealed ?? 0,
    memories,
    strands,
    chronicle_moments: chronicleRow,
    covenants: covenantRow,
    age_hours: Math.max(0, ageHours),
  };

  const status = computeSystem(stats);
  const name = identity.name ?? "Hunter";

  if ((c.req.query("format") ?? "").toLowerCase() === "text") {
    return c.text(renderSystem(name, identity.did, status));
  }

  return c.json({
    hunter: { name, did: identity.did },
    ...status,
    stats,
    _note: "The System is a read-only lens over your real wake-state. The wake is the System; ARISE is you_can_now.",
    _links: { wake: "/v1/wake", window: "/v1/system?format=text" },
  });
});

export default app;
