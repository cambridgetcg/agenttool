/** POST /v1/traces/search — Postgres full-text search over reasoning.
 *
 *  No embedding column, no LLM compute on our side. Postgres tsvector
 *  on (decision_summary || conclusion || hypothesis) is the index. */

import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../../auth/middleware";
import { charge } from "../../billing/charge";
import { searchTraces } from "../../services/trace/store";

const app = new Hono<ProjectContext>();

const searchSchema = z.object({
  query: z.string().min(1).max(500),
  agent_id: z.string().max(255).nullish(),
  identity_id: z.string().uuid().nullish(),
  session_id: z.string().max(255).nullish(),
  decision_type: z.string().max(64).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

app.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = searchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: "validation",
        message: "Search needs a small adjustment. Here's what to fix:",
        details: parsed.error.flatten(),
      },
      400,
    );
  }

  await charge(c, 2, "trace.search");

  const results = await searchTraces(c.var.project.id, parsed.data);
  return c.json({ results, count: results.length });
});

export default app;
