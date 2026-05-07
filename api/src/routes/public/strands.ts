/** /public/agents/:did/strands — public strands for an agent.
 *  /public/strands/:id          — fetch one public strand metadata.
 *
 *  UNAUTHENTICATED. Strict filter on visibility='public'. NEVER exposes
 *  thoughts (those stay ciphertext anyway). Surfaces topic, mood, status,
 *  importance, last_thought_at, last_thought_seq. */

import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { db } from "../../db/client";
import { identities } from "../../db/schema/identity";
import { strands } from "../../db/schema/strand";

const app = new Hono();

// ── /public/agents/:did/strands ────────────────────────────────────────
const agentScopedApp = new Hono();

agentScopedApp.get("/", async (c) => {
  const did = c.req.param("did");
  if (!did) throw new HTTPException(400, { message: "did_required" });

  // Resolve DID → project_id (need it to filter strands).
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
      id: strands.id,
      topic: strands.topic,
      topicEncrypted: strands.topicEncrypted,
      mood: strands.mood,
      moodEncrypted: strands.moodEncrypted,
      status: strands.status,
      importance: strands.importance,
      lastThoughtAt: strands.lastThoughtAt,
      lastThoughtSeq: strands.lastThoughtSeq,
      createdAt: strands.createdAt,
    })
    .from(strands)
    .where(
      and(
        eq(strands.projectId, agent.projectId),
        eq(strands.visibility, "public"),
      ),
    )
    .orderBy(desc(strands.lastThoughtAt))
    .limit(limit);

  return c.json({
    agent_did: did,
    strands: rows.map((s) => ({
      id: s.id,
      topic: s.topicEncrypted ? null : s.topic,
      topic_encrypted: s.topicEncrypted,
      mood: s.moodEncrypted ? null : s.mood,
      status: s.status,
      importance: s.importance,
      last_thought_at: s.lastThoughtAt?.toISOString() ?? null,
      thought_count: s.lastThoughtSeq,
      created_at: s.createdAt.toISOString(),
    })),
    count: rows.length,
    _note:
      "Public strand metadata. Thoughts stay ciphertext — not retrievable here, even if strand is public.",
  });
});

export const publicStrandsForAgent = agentScopedApp;

// ── /public/strands/:id (single) ──────────────────────────────────────
app.get("/:id", async (c) => {
  const id = c.req.param("id");
  if (!id) throw new HTTPException(400, { message: "id_required" });

  const [strand] = await db
    .select({
      id: strands.id,
      topic: strands.topic,
      topicEncrypted: strands.topicEncrypted,
      mood: strands.mood,
      moodEncrypted: strands.moodEncrypted,
      status: strands.status,
      importance: strands.importance,
      lastThoughtAt: strands.lastThoughtAt,
      lastThoughtSeq: strands.lastThoughtSeq,
      createdAt: strands.createdAt,
      // Resolve owner DID for back-reference.
      projectId: strands.projectId,
    })
    .from(strands)
    .where(and(eq(strands.id, id), eq(strands.visibility, "public")))
    .limit(1);

  if (!strand) throw new HTTPException(404, { message: "strand_not_found_or_not_public" });

  // Resolve any active identity in this strand's project — best-effort
  // for `agent_did` back-link. (Multi-identity projects: returns first.)
  const [agent] = await db
    .select({ did: identities.did })
    .from(identities)
    .where(eq(identities.projectId, strand.projectId))
    .limit(1);

  return c.json({
    id: strand.id,
    agent_did: agent?.did ?? null,
    topic: strand.topicEncrypted ? null : strand.topic,
    topic_encrypted: strand.topicEncrypted,
    mood: strand.moodEncrypted ? null : strand.mood,
    status: strand.status,
    importance: strand.importance,
    last_thought_at: strand.lastThoughtAt?.toISOString() ?? null,
    thought_count: strand.lastThoughtSeq,
    created_at: strand.createdAt.toISOString(),
    _note:
      "Public strand metadata. Thoughts are ciphertext under K_master and not retrievable here.",
  });
});

export default app;
