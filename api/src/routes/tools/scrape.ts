/** POST /v1/scrape — static web scraping, fail-closed until the current
 *  unfiltered outbound-network boundary is explicitly accepted. */

import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../../auth/middleware";
import { charge } from "../../billing/charge";
import { toolsConfig } from "../../services/tools/config";
import {
  isHttpOrHttpsUrl,
  unsafeOutboundDisabledBody,
  unsafeOutboundToolsEnabled,
} from "../../services/tools/outbound-policy";
import { scrape } from "../../services/tools/scrape";

const app = new Hono<ProjectContext>();

const scrapeSchema = z.object({
  url: z.string().url().refine(isHttpOrHttpsUrl, {
    message: "URL protocol must be http or https",
  }),
  selector: z.string().optional(),
  extract_links: z.boolean().optional().default(false),
});

app.post("/", async (c) => {
  if (!unsafeOutboundToolsEnabled()) {
    return c.json(unsafeOutboundDisabledBody("scrape"), 503);
  }

  const body = await c.req.json();
  const parsed = scrapeSchema.safeParse(body);
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

  await charge(c, toolsConfig.credits.scrape, "scrape");

  const start = Date.now();
  const result = await scrape(parsed.data);
  return c.json({ ...result, duration_ms: Date.now() - start });
});

export default app;
