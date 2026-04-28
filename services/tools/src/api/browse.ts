/** POST /v1/browse — managed browser session.
 *
 * If the page loads in < 5s and no async actions, returns result inline.
 * Otherwise returns a job_id for polling via GET /v1/jobs/:id.
 */

import { Hono } from "hono";
import { z } from "zod";
import { browseQueue } from "../queue/browse-queue";
import type { ProjectContext } from "../auth/middleware";
import { config } from "../config";

const browseApp = new Hono<ProjectContext>();

const BrowseActionSchema = z.object({
  type: z.enum(["click", "type", "scroll", "wait", "select"]),
  selector: z.string().optional(),
  text: z.string().optional(),
  value: z.string().optional(),
  delay: z.number().optional(),
});

const BrowseRequestSchema = z.object({
  url: z.string().url(),
  actions: z.array(BrowseActionSchema).optional(),
  extract: z.string().optional(), // "text" | "html" | CSS selector
  screenshot: z.boolean().optional().default(false),
  timeout: z.number().min(1000).max(60_000).optional().default(30_000),
});

browseApp.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = BrowseRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", message: "The request needs a small adjustment. Here's what to fix:", details: parsed.error.flatten(), docs: "https://docs.agenttool.dev/tools" }, 400);
  }

  const project = c.get("project");
  const creditCost = config.credits.browse;

  // Check credits
  if (project.credits < creditCost) {
    return c.json({ error: "Insufficient credits", required: creditCost, balance: project.credits }, 402);
  }

  // Add job to queue
  const job = await browseQueue.add("browse", {
    projectId: project.id,
    ...parsed.data,
  });

  // Try to wait for quick result (5s)
  try {
    const result = await job.waitUntilFinished(browseQueue.events, 5_000);

    // Deduct credits (TODO: move to billing service)
    return c.json({
      status: "completed",
      job_id: job.id,
      result,
    });
  } catch {
    // Job still running — return job_id for polling
    return c.json({
      status: "queued",
      job_id: job.id,
      poll: `/v1/jobs/${job.id}`,
    }, 202);
  }
});

export { browseApp };

export default browseApp;
