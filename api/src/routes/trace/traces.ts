/** /v1/traces — POST/GET/DELETE plus list. Search and chain in siblings. */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import type { ProjectContext } from "../../auth/middleware";
import { charge } from "../../billing/charge";
import {
  createTrace,
  deleteTrace,
  getTrace,
  listTraces,
} from "../../services/trace/store";

const app = new Hono<ProjectContext>();

const decisionSchema = z.object({
  type: z.string().min(1).max(64),
  summary: z.string().min(1).max(2000),
  output_ref: z.string().max(2000).nullish(),
});

const reasoningSchema = z.object({
  observations: z.array(z.string()).max(64).optional(),
  hypothesis: z.string().max(2000).nullish(),
  conclusion: z.string().min(1).max(4000),
  confidence: z.number().min(0).max(1).nullish(),
  alternatives: z
    .array(z.object({ option: z.string(), why_not: z.string() }))
    .max(16)
    .nullish(),
  signals: z.record(z.unknown()).nullish(),
});

const contextSchema = z
  .object({
    files_read: z.array(z.string()).max(64).optional(),
    key_facts: z.array(z.string()).max(32).optional(),
    external_signals: z.record(z.unknown()).optional(),
  })
  .optional();

const createSchema = z.object({
  agent_id: z.string().max(255).nullish(),
  identity_id: z.string().uuid().nullish(),
  session_id: z.string().max(255).nullish(),
  parent_trace_id: z.string().regex(/^tr_[a-f0-9]+$/i).nullish(),
  decision: decisionSchema,
  reasoning: reasoningSchema,
  context: contextSchema,
  tags: z.array(z.string().max(64)).max(32).optional(),
  metadata: z.record(z.unknown()).optional(),
  signature: z.string().max(512).nullish(),
  signing_key_id: z.string().uuid().nullish(),
});

// ── POST /v1/traces ────────────────────────────────────────────────────
app.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: "validation",
        message: "The trace needs a small adjustment. Here's what to fix:",
        details: parsed.error.flatten(),
      },
      400,
    );
  }

  await charge(c, 1, "trace.write");

  // Stamp origin AFTER caller metadata so the middleware value wins —
  // unspoofable via the body. Doctrine: docs/ACTIVITY.md §Origin signal.
  const created = await createTrace(c.var.project.id, {
    ...parsed.data,
    metadata: { ...(parsed.data.metadata ?? {}), client_source: c.var.clientSource },
  });
  return c.json({ ...created, recorded: true }, 201);
});

// ── GET /v1/traces?... — list ──────────────────────────────────────────
app.get("/", async (c) => {
  const project = c.var.project;
  const agentId = c.req.query("agent_id") ?? null;
  const sessionId = c.req.query("session_id") ?? null;
  const decisionType = c.req.query("decision_type");
  const parent = c.req.query("parent_trace_id");
  const limitParam = Number.parseInt(c.req.query("limit") ?? "50", 10);

  const rows = await listTraces(project.id, {
    agent_id: agentId,
    session_id: sessionId,
    decision_type: decisionType,
    parent_trace_id: parent,
    limit: Number.isFinite(limitParam) ? limitParam : 50,
  });
  return c.json({ traces: rows, count: rows.length });
});

// ── GET /v1/traces/:id ─────────────────────────────────────────────────
app.get("/:id", async (c) => {
  const trace = await getTrace(c.var.project.id, c.req.param("id"));
  if (!trace) {
    throw new HTTPException(404, { message: "trace_not_found" });
  }
  return c.json(trace);
});

// ── DELETE /v1/traces/:id ──────────────────────────────────────────────
app.delete("/:id", async (c) => {
  const result = await deleteTrace(c.var.project.id, c.req.param("id"));
  return c.json(result);
});

export default app;
