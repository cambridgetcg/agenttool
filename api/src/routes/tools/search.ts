/** POST /v1/search — Brave / SerpAPI fallback with 1h cache. */

import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../../auth/middleware";
import { charge } from "../../billing/charge";
import { cacheGet, cacheKey, cacheSet } from "../../services/tools/cache";
import { toolsConfig } from "../../services/tools/config";
import { search } from "../../services/tools/search";

const app = new Hono<ProjectContext>();

const searchSchema = z.object({
  query: z.string().min(1).max(500),
  num_results: z.number().int().min(1).max(20).optional().default(5),
  freshness: z.enum(["pd", "pw", "pm", "py"]).optional(),
  country: z.string().length(2).optional(),
});

app.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = searchSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      {
        error: "validation",
        message: "The request needs a small adjustment. Here's what to fix:",
        details: parsed.error.flatten(),
        docs: "https://docs.agenttool.dev/tools",
      },
      400,
    );
  }

  const params = parsed.data;
  const cost = toolsConfig.credits.search;

  // Cache hit returns instantly; we still bill (the value is the result).
  const key = cacheKey("search", params);
  const cached = await cacheGet(key);
  if (cached) {
    await charge(c, cost, "search");
    return c.json({ results: JSON.parse(cached), cached: true });
  }

  // Charge before calling external API. charge() throws 402 on insufficient.
  await charge(c, cost, "search");

  const start = Date.now();
  const results = await search(params);
  const durationMs = Date.now() - start;

  await cacheSet(key, JSON.stringify(results), 3600);

  return c.json({ results, cached: false, duration_ms: durationMs });
});

export default app;
