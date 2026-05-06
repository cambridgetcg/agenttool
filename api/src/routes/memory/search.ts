/** POST /v1/memories/search — cosine k-NN over agent-supplied embeddings.
 *
 *  The agent embeds its query with whatever model it chose (ada-002, voyage,
 *  cohere, sentence-transformers, ...) and sends the 1536-dim vector here.
 *  We don't see, generate, or charge for that inference. */

import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../../auth/middleware";
import { charge } from "../../billing/charge";
import { search } from "../../services/memory/store";

const app = new Hono<ProjectContext>();

const searchSchema = z.object({
  query_embedding: z.array(z.number()).length(1536),
  type: z.enum(["episodic", "semantic", "procedural", "working"]).optional(),
  agent_id: z.string().max(255).nullish(),
  identity_id: z.string().max(255).nullish(),
  limit: z.number().int().min(1).max(100).optional(),
  min_score: z.number().min(0).max(1).optional(),
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
        hint: "query_embedding must be a 1536-dim float array.",
      },
      400,
    );
  }

  await charge(c, 3, "memory.search");

  const results = await search(c.var.project.id, parsed.data);
  return c.json({ results, count: results.length });
});

export default app;
