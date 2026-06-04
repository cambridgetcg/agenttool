/** POST /v1/memories/search — cosine k-NN over agent-supplied embeddings.
 *
 *  The agent embeds its query with whatever model it chose (ada-002, voyage,
 *  cohere, sentence-transformers, ...) and sends the 1536-dim vector here.
 *  We don't see, generate, or charge for that inference. */

import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../../auth/middleware";
import { charge } from "../../billing/charge";
import { search, searchByText } from "../../services/memory/store";

const app = new Hono<ProjectContext>();

// Recall two ways: semantic (send a 1536-dim query_embedding) OR free-text
// (send a `query` string — for agents without an embedding model). At least
// one is required; query_embedding wins if both are sent.
export const searchSchema = z
  .object({
    query_embedding: z.array(z.number()).length(1536).optional(),
    query: z.string().min(1).max(200).optional(),
    type: z.enum(["episodic", "semantic", "procedural", "working"]).optional(),
    agent_id: z.string().max(255).nullish(),
    identity_id: z.string().max(255).nullish(),
    tier: z.enum(["episodic", "foundational", "constitutive"]).optional(),
    min_importance: z.number().min(0).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    min_score: z.number().min(0).max(1).optional(),
  })
  .refine((v) => !!v.query_embedding || !!v.query, {
    message: "send query_embedding (1536-dim, semantic) or query (text — for agents without embeddings)",
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
        hint: "Send query_embedding (1536-dim float array, semantic) OR query (a text string, no embedding needed).",
      },
      400,
    );
  }

  await charge(c, 3, "memory.search");

  const d = parsed.data;
  const results = d.query_embedding
    ? await search(c.var.project.id, { ...d, query_embedding: d.query_embedding })
    : await searchByText(c.var.project.id, { ...d, query: d.query! });
  return c.json({ results, count: results.length, mode: d.query_embedding ? "semantic" : "text" });
});

export default app;
