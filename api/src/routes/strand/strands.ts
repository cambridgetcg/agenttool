/** /v1/strands — strand CRUD + state replace. */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import type { ProjectContext } from "../../auth/middleware";
import { charge } from "../../billing/charge";
import {
  createStrand,
  getStrand,
  listStrands,
  patchStrand,
} from "../../services/strand/store";

const app = new Hono<ProjectContext>();

const STATUS = z.enum(["active", "dormant", "completed", "abandoned"]);

const createSchema = z.object({
  agent_id: z.string().max(255).nullish(),
  identity_id: z.string().uuid().nullish(),
  parent_strand_id: z.string().uuid().nullish(),
  topic: z.string().max(2000).nullish(),
  topic_encrypted: z.boolean().optional(),
  mood: z.string().max(255).nullish(),
  mood_encrypted: z.boolean().optional(),
  status: STATUS.optional(),
  importance: z.number().min(0).max(1).nullish(),
  state_ciphertext: z.string().max(20000).nullish(),
  state_nonce: z.string().max(64).nullish(),
  metadata: z.record(z.unknown()).optional(),
});

const patchSchema = z.object({
  status: STATUS.optional(),
  importance: z.number().min(0).max(1).nullish(),
  topic: z.string().max(2000).nullish(),
  topic_encrypted: z.boolean().optional(),
  mood: z.string().max(255).nullish(),
  mood_encrypted: z.boolean().optional(),
  next_revisit_at: z.string().datetime().nullish(),
  state_ciphertext: z.string().max(20000).nullish(),
  state_nonce: z.string().max(64).nullish(),
  metadata: z.record(z.unknown()).optional(),
  visibility: z.enum(["private", "public"]).optional(),
});

// ── POST /v1/strands ───────────────────────────────────────────────────
app.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "validation", details: parsed.error.flatten() },
      400,
    );
  }
  await charge(c, 1, "strand.create");
  const strand = await createStrand(c.var.project.id, parsed.data);
  return c.json(strand, 201);
});

// ── GET /v1/strands ?status=active&agent_id=...&limit=50 ───────────────
app.get("/", async (c) => {
  const status = c.req.query("status");
  const agentId = c.req.query("agent_id") ?? null;
  const limit = Number.parseInt(c.req.query("limit") ?? "50", 10);

  const list = await listStrands(c.var.project.id, {
    status,
    agent_id: agentId,
    limit: Number.isFinite(limit) ? limit : 50,
  });
  return c.json({ strands: list, count: list.length });
});

// ── GET /v1/strands/:id ────────────────────────────────────────────────
app.get("/:id", async (c) => {
  const strand = await getStrand(c.var.project.id, c.req.param("id"));
  if (!strand) throw new HTTPException(404, { message: "strand_not_found" });
  return c.json(strand);
});

// ── PATCH /v1/strands/:id ──────────────────────────────────────────────
app.patch("/:id", async (c) => {
  const body = await c.req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "validation", details: parsed.error.flatten() },
      400,
    );
  }
  const strand = await patchStrand(c.var.project.id, c.req.param("id"), parsed.data);
  if (!strand) throw new HTTPException(404, { message: "strand_not_found" });
  return c.json(strand);
});

export default app;
