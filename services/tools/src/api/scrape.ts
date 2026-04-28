/** POST /v1/scrape — static web scraping via Cheerio. */

import { Hono } from "hono";
import { z } from "zod";

import { scrape } from "../tools/scrape";
import { deductCredits, logFailedUsage } from "../billing/credits";
import { config } from "../config";
import type { ProjectContext } from "../auth/middleware";

const scrapeRouter = new Hono<ProjectContext>();

const ScrapeRequest = z.object({
  url: z.string().url(),
  selector: z.string().optional(),
  extract_links: z.boolean().optional().default(false),
});

scrapeRouter.post("/scrape", async (c) => {
  const project = c.get("project");
  const body = await c.req.json();
  const parsed = ScrapeRequest.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "validation", message: "The request needs a small adjustment. Here's what to fix:", details: parsed.error.flatten(), docs: "https://docs.agenttool.dev/tools" }, 400);
  }

  const params = parsed.data;
  const creditCost = config.credits.scrape;

  // Deduct credits
  const ok = await deductCredits(project.id, "scrape", creditCost);
  if (!ok) {
    return c.json({ error: "Insufficient credits" }, 402);
  }

  const start = Date.now();
  try {
    const result = await scrape(params);
    return c.json({ ...result, duration_ms: Date.now() - start });
  } catch (err) {
    await logFailedUsage(project.id, "scrape", Date.now() - start);
    const message = err instanceof Error ? err.message : "Scrape failed";
    return c.json({ error: message }, 502);
  }
});

export { scrapeRouter };

export default scrapeRouter;
