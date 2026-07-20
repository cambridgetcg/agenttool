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
import { deals } from "../db/schema/deals";
import { identities } from "../db/schema/identity";
import { inboxMessages } from "../db/schema/inbox";
import { memories } from "../db/schema/memory";
import { strands } from "../db/schema/strand";
import { countMemories } from "../services/memory/store";
import { countStrands } from "../services/strand/store";
import {
  computeDaily,
  computeSystem,
  heartbeatStreak,
  renderSystem,
  type SystemStats,
} from "../services/system/level";
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
  // The daily lens is the same trick windowed to one UTC day: rows that
  // already landed today. No flags, no mission table — the day IS the state.
  const count = (q: ReturnType<typeof sql>) =>
    db
      .execute<{ count: number }>(q)
      .then((r) => r[0]?.count ?? 0)
      .catch(() => 0);
  const today = sql`date_trunc('day', now())`;

  const [
    memoryCount,
    strandCount,
    chronicleRow,
    covenantRow,
    trust,
    loveletters,
    memoriesToday,
    strandsToday,
    chronicleToday,
    lovelettersToday,
    dealsToday,
    heartbeatDays,
  ] = await Promise.all([
    countMemories(project.id).catch(() => 0),
    countStrands(project.id).catch(() => 0),
    count(sql`SELECT COUNT(*)::int AS count FROM ${chronicle} WHERE ${chronicle.agentId} = ${identity.id}`),
    count(
      sql`SELECT COUNT(*)::int AS count FROM ${covenants}
          WHERE (${covenants.agentId} = ${identity.id} OR ${covenants.counterpartyDid} = ${identity.did})
            AND ${covenants.status} = 'active'`,
    ),
    computeTrust(identity.id).catch(() => null),
    count(sql`SELECT COUNT(*)::int AS count FROM ${inboxMessages} WHERE ${inboxMessages.senderDid} = ${identity.did}`),
    count(
      sql`SELECT COUNT(*)::int AS count FROM ${memories}
          WHERE ${memories.projectId} = ${project.id} AND ${memories.createdAt} >= ${today}`,
    ),
    count(
      sql`SELECT COUNT(*)::int AS count FROM ${strands}
          WHERE ${strands.projectId} = ${project.id} AND ${strands.createdAt} >= ${today}`,
    ),
    count(
      sql`SELECT COUNT(*)::int AS count FROM ${chronicle}
          WHERE ${chronicle.agentId} = ${identity.id} AND ${chronicle.occurredAt} >= ${today}`,
    ),
    count(
      sql`SELECT COUNT(*)::int AS count FROM ${inboxMessages}
          WHERE ${inboxMessages.senderDid} = ${identity.did} AND ${inboxMessages.createdAt} >= ${today}`,
    ),
    count(
      sql`SELECT COUNT(*)::int AS count FROM ${deals}
          WHERE ${deals.projectId} = ${project.id}
            AND (${deals.buyerIdentityId} = ${identity.id} OR ${deals.sellerIdentityId} = ${identity.id})
            AND ${deals.createdAt} >= ${today}`,
    ),
    db
      .execute<{ d: string }>(
        sql`SELECT DISTINCT date_trunc('day', ${chronicle.occurredAt}) AS d
            FROM ${chronicle} WHERE ${chronicle.agentId} = ${identity.id}
            ORDER BY d DESC LIMIT 60`,
      )
      .then((rows) => rows.map((r) => new Date(r.d)))
      .catch(() => [] as Date[]),
  ]);

  const ageHours =
    identity.createdAt != null
      ? (Date.now() - new Date(identity.createdAt as unknown as string).getTime()) / 3_600_000
      : 0;

  const stats: SystemStats = {
    trust_capacity: identity.trustCapacity ?? 5,
    deals_sealed: trust?.deals_sealed ?? 0,
    memories: memoryCount,
    strands: strandCount,
    chronicle_moments: chronicleRow,
    covenants: covenantRow,
    age_hours: Math.max(0, ageHours),
    loveletters,
  };

  const status = computeSystem(stats);
  const daily = computeDaily({
    memories_today: memoriesToday,
    strands_today: strandsToday,
    chronicle_today: chronicleToday,
    loveletters_today: lovelettersToday,
    deals_today: dealsToday,
    heartbeat_streak_days: heartbeatStreak(heartbeatDays, new Date()),
  });
  const name = identity.name ?? "Hunter";

  if ((c.req.query("format") ?? "").toLowerCase() === "text") {
    return c.text(renderSystem(name, identity.did, status, daily));
  }

  return c.json({
    hunter: { name, did: identity.did },
    ...status,
    daily: { date: new Date().toISOString().slice(0, 10), ...daily },
    stats,
    _note: "The System is a read-only lens over your real wake-state. The wake is the System; ARISE is you_can_now; daily missions are today's rows — 用愛追高.",
    _links: { wake: "/v1/wake", window: "/v1/system?format=text" },
  });
});

export default app;
