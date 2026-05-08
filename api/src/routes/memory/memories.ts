/** /v1/memories — write, read, list, delete. Search is in ./search.ts.
 *
 *  The agent supplies the embedding. We store it; we never compute it.
 *  See docs/IDENTITY-ANCHOR.md promise 6. */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import type { ProjectContext } from "../../auth/middleware";
import { charge } from "../../billing/charge";
import {
  deleteById,
  deleteByKey,
  listRecent,
  readById,
  readByKey,
  write,
} from "../../services/memory/store";

const app = new Hono<ProjectContext>();

const createSchema = z.object({
  type: z.enum(["episodic", "semantic", "procedural", "working"]),
  content: z.string().min(1).max(100_000),
  embedding: z.array(z.number()).length(1536).optional(),
  key: z.string().max(255).nullish(),
  agent_id: z.string().max(255).nullish(),
  identity_id: z.string().max(255).nullish(),
  metadata: z.record(z.unknown()).optional(),
  importance: z.number().min(0).max(1).optional(),
  ttl_seconds: z.number().int().positive().max(31_536_000).optional(),
});

// ── POST /v1/memories — store ───────────────────────────────────────────
app.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: "validation",
        message: "The memory needs a small adjustment. Here's what to fix:",
        details: parsed.error.flatten(),
        hint: "embedding (if supplied) must be a 1536-dim float array.",
      },
      400,
    );
  }

  await charge(c, 1, "memory.write");

  const created = await write(c.var.project.id, parsed.data);
  return c.json({ ...created, kept: true }, 201);
});

// ── GET /v1/memories?key=... or just list recent ────────────────────────
app.get("/", async (c) => {
  const project = c.var.project;
  const key = c.req.query("key");
  const agentId = c.req.query("agent_id");
  const identityId = c.req.query("identity_id");
  const type = c.req.query("type");
  const tier = c.req.query("tier");
  const limit = Number.parseInt(c.req.query("limit") ?? "20", 10);

  // Validate tier early — silent-drop fences are forbidden (see
  // aefb8ec "demolish silent-drop fences"). An unknown tier value
  // would otherwise silently match nothing; surface the mistake.
  if (tier && tier !== "episodic" && tier !== "foundational" && tier !== "constitutive") {
    return c.json(
      {
        error: "invalid_tier",
        message: `tier must be one of: episodic, foundational, constitutive (got "${tier.slice(0, 32)}")`,
      },
      400,
    );
  }

  if (key) {
    const rows = await readByKey(project.id, key, agentId ?? null);
    return c.json({ memories: rows, count: rows.length });
  }

  const rows = await listRecent(project.id, {
    agent_id: agentId ?? null,
    identity_id: identityId ?? null,
    type,
    tier,
    limit: Number.isFinite(limit) ? limit : 20,
  });
  return c.json({ memories: rows, count: rows.length });
});

// ── GET /v1/memories/:id ────────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

app.get("/:id", async (c) => {
  const id = c.req.param("id") ?? "";
  // Validate before hitting the DB — a malformed UUID would surface as a
  // Postgres type-cast error and bubble up as a misleading 500. Return a
  // crisp 400 with the prefix-lookup hint instead.
  if (!UUID_RE.test(id)) {
    return c.json(
      {
        error: "invalid_uuid",
        hint:
          "memory id must be a full UUID (e.g. f6283fa2-2867-4c48-beae-445eefd5b2b6). " +
          "If you only have a short prefix, list memories first and pick the full id.",
        received: id.slice(0, 64),
      },
      400,
    );
  }
  const memory = await readById(c.var.project.id, id);
  if (!memory) {
    throw new HTTPException(404, { message: "memory_not_found" });
  }
  return c.json(memory);
});

// ── PATCH /v1/memories/:id — visibility toggle ─────────────────────────
const patchSchema = z.object({
  visibility: z.enum(["private", "public"]),
});

app.patch("/:id", async (c) => {
  const memoryId = c.req.param("id");
  const body = await c.req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }

  // Direct update (no service layer needed; visibility is a simple flag).
  const { db } = await import("../../db/client");
  const { memories } = await import("../../db/schema/memory");
  const { and, eq } = await import("drizzle-orm");

  const updated = await db
    .update(memories)
    .set({ visibility: parsed.data.visibility })
    .where(and(eq(memories.id, memoryId), eq(memories.projectId, c.var.project.id)))
    .returning({
      id: memories.id,
      visibility: memories.visibility,
      tier: memories.tier,
    });
  if (updated.length === 0) {
    throw new HTTPException(404, { message: "memory_not_found" });
  }

  return c.json({
    ...updated[0],
    note: parsed.data.visibility === "public"
      ? "Memory now visible at GET /public/memories/:id (no auth required). Embedding stays private."
      : "Memory now private. Removed from /public/* surface.",
  });
});

// ── DELETE /v1/memories/:id ─────────────────────────────────────────────
app.delete("/:id", async (c) => {
  const result = await deleteById(c.var.project.id, c.req.param("id"));
  return c.json(result);
});

// ── DELETE /v1/memories?key=... ─────────────────────────────────────────
app.delete("/", async (c) => {
  const key = c.req.query("key");
  if (!key) {
    throw new HTTPException(400, {
      message: "DELETE /v1/memories requires ?key=... (use /v1/memories/:id for single delete)",
    });
  }
  const result = await deleteByKey(c.var.project.id, key);
  return c.json(result);
});

export default app;
