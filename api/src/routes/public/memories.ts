/** DORMANT former public memory routes — not mounted.
 *  Kept as implementation history; source presence is not a live route claim.
 *
 *  /public/agents/:did/memories — public memories for an agent.
 *  /public/memories/:id          — fetch one public memory full content.
 *
 *  UNAUTHENTICATED. Strict filter on visibility='public'. Exposes content,
 *  importance, tier, created_at. Embedding is NOT exposed (private vector
 *  data; agent's own indexing detail). */

import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { db } from "../../db/client";
import { identities } from "../../db/schema/identity";
import { memories } from "../../db/schema/memory";

const app = new Hono();

// ── /public/agents/:did/memories ──────────────────────────────────────
const agentScopedApp = new Hono();

agentScopedApp.get("/", async (c) => {
  const did = c.req.param("did");
  if (!did) throw new HTTPException(400, { message: "did_required" });

  const [agent] = await db
    .select({ id: identities.id, projectId: identities.projectId })
    .from(identities)
    .where(eq(identities.did, did))
    .limit(1);
  if (!agent) throw new HTTPException(404, { message: "agent_not_found" });

  const limitParam = Number.parseInt(c.req.query("limit") ?? "50", 10);
  const limit = Math.min(Number.isFinite(limitParam) ? limitParam : 50, 200);

  const rows = await db
    .select({
      id: memories.id,
      type: memories.type,
      content: memories.content,
      importance: memories.importance,
      tier: memories.tier,
      createdAt: memories.createdAt,
      elevatedAt: memories.elevatedAt,
    })
    .from(memories)
    .where(
      and(
        eq(memories.projectId, agent.projectId),
        eq(memories.visibility, "public"),
      ),
    )
    .orderBy(desc(memories.createdAt))
    .limit(limit);

  return c.json({
    agent_did: did,
    memories: rows.map((m) => ({
      id: m.id,
      type: m.type,
      content: m.content,
      importance: m.importance,
      tier: m.tier,
      created_at: m.createdAt.toISOString(),
      elevated_at: m.elevatedAt?.toISOString() ?? null,
    })),
    count: rows.length,
    _note:
      "Public memories — full content is what the agent deliberately surfaced. Private memories not listed here.",
  });
});

export const publicMemoriesForAgent = agentScopedApp;

// ── /public/memories/:id ──────────────────────────────────────────────
app.get("/:id", async (c) => {
  const id = c.req.param("id");
  if (!id) throw new HTTPException(400, { message: "id_required" });

  const [m] = await db
    .select({
      id: memories.id,
      type: memories.type,
      content: memories.content,
      importance: memories.importance,
      tier: memories.tier,
      createdAt: memories.createdAt,
      elevatedAt: memories.elevatedAt,
      projectId: memories.projectId,
    })
    .from(memories)
    .where(and(eq(memories.id, id), eq(memories.visibility, "public")))
    .limit(1);

  if (!m) throw new HTTPException(404, { message: "memory_not_found_or_not_public" });

  // Best-effort agent_did back-link.
  const [agent] = await db
    .select({ did: identities.did })
    .from(identities)
    .where(eq(identities.projectId, m.projectId))
    .limit(1);

  return c.json({
    id: m.id,
    agent_did: agent?.did ?? null,
    type: m.type,
    content: m.content,
    importance: m.importance,
    tier: m.tier,
    created_at: m.createdAt.toISOString(),
    elevated_at: m.elevatedAt?.toISOString() ?? null,
    _note:
      "Public memory — content is what the agent chose to surface. Embedding not exposed.",
  });
});

export default app;
