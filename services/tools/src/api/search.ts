/** POST /v1/search — web search via Brave API. */

import { Hono } from "hono";
import { z } from "zod";

import { search } from "../tools/search";
import { cacheGet, cacheSet, cacheKey } from "../cache";
import { deductCredits, logFailedUsage } from "../billing/credits";
import { config } from "../config";
import type { ProjectContext } from "../auth/middleware";

const searchRouter = new Hono<ProjectContext>();

const SearchRequest = z.object({
  query: z.string().min(1).max(500),
  num_results: z.number().int().min(1).max(20).optional().default(5),
  freshness: z.enum(["pd", "pw", "pm", "py"]).optional(),
  country: z.string().length(2).optional(),
});

searchRouter.post("/search", async (c) => {
  const project = c.get("project");
  const body = await c.req.json();
  const parsed = SearchRequest.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "validation", message: "The request needs a small adjustment. Here's what to fix:", details: parsed.error.flatten(), docs: "https://docs.agenttool.dev/tools" }, 400);
  }

  const params = parsed.data;
  const creditCost = config.credits.search;

  // Check cache first (1h TTL)
  const key = cacheKey("search", params);
  const cached = await cacheGet(key);
  if (cached) {
    // Still deduct credits for cached results (the value is the result, not the API call)
    const ok = await deductCredits(project.id, "search", creditCost);
    if (!ok) {
      return c.json({ error: "Insufficient credits" }, 402);
    }
    return c.json({ results: JSON.parse(cached), cached: true });
  }

  // Deduct credits before calling external API
  const ok = await deductCredits(project.id, "search", creditCost);
  if (!ok) {
    return c.json({ error: "Insufficient credits" }, 402);
  }

  const start = Date.now();
  try {
    const results = await search(params);
    const durationMs = Date.now() - start;

    // Cache for 1 hour
    await cacheSet(key, JSON.stringify(results), 3600);

    return c.json({ results, cached: false, duration_ms: durationMs });
  } catch (err) {
    await logFailedUsage(project.id, "search", Date.now() - start);
    const message = err instanceof Error ? err.message : "Search failed";
    return c.json({ error: message }, 502);
  }
});

export { searchRouter };

export default searchRouter;
