/** POST /v1/browse — managed browser session via BullMQ + Playwright.
 *
 *  Quick page loads (≤5s) return the result inline; longer ones return a
 *  job_id for polling at /v1/jobs/:id. URL, actions, page content, and
 *  screenshots are server-readable. The route fails closed unless the
 *  operator accepts the current SSRF boundary, and then still requires Redis.
 *  Chromium runs with --no-sandbox and has no private-address allowlist.
 *  BullMQ may attempt a job twice. */

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
import {
  browseQueue,
  browseQueueEvents,
} from "../../services/tools/queue/browse-queue";

const app = new Hono<ProjectContext>();

const browseActionSchema = z.object({
  type: z.enum(["click", "type", "scroll", "wait", "select"]),
  selector: z.string().optional(),
  text: z.string().optional(),
  value: z.string().optional(),
  delay: z.number().optional(),
});

const browseSchema = z.object({
  url: z.string().url().refine(isHttpOrHttpsUrl, {
    message: "URL protocol must be http or https",
  }),
  actions: z.array(browseActionSchema).optional(),
  extract: z.string().optional(),
  screenshot: z.boolean().optional().default(false),
  timeout: z.number().min(1000).max(60_000).optional().default(30_000),
});

app.post("/", async (c) => {
  if (!unsafeOutboundToolsEnabled()) {
    return c.json(unsafeOutboundDisabledBody("browse"), 503);
  }

  const body = await c.req.json();
  const parsed = browseSchema.safeParse(body);
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

  if (!browseQueue || !browseQueueEvents) {
    return c.json(
      { error: "redis_disabled", message: "browse jobs disabled (AGENTTOOL_DISABLE_WORKERS=1)" },
      503,
    );
  }

  await charge(c, toolsConfig.credits.browse, "browse");

  const project = c.var.project;
  const job = await browseQueue.add("browse", {
    projectId: project.id,
    ...parsed.data,
  });

  // Try to wait for a quick result (5s). Longer jobs return a poll target.
  try {
    const result = await job.waitUntilFinished(browseQueueEvents, 5_000);
    return c.json({
      status: "completed",
      job_id: job.id,
      result,
    });
  } catch {
    return c.json(
      {
        status: "queued",
        job_id: job.id,
        poll: `/v1/jobs/${job.id}`,
      },
      202,
    );
  }
});

export default app;
