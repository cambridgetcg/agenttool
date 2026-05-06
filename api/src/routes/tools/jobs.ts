/** GET /v1/jobs/:id — poll async job results (currently: browse). */

import { Hono } from "hono";

import type { ProjectContext } from "../../auth/middleware";
import { browseQueue } from "../../services/tools/queue/browse-queue";

const app = new Hono<ProjectContext>();

app.get("/:id", async (c) => {
  const jobId = c.req.param("id");

  const job = await browseQueue.getJob(jobId);
  if (!job) {
    return c.json({ error: "Job not found" }, 404);
  }

  // Project ownership: the job's projectId must match the caller.
  if (job.data.projectId !== c.var.project.id) {
    return c.json({ error: "Job not found" }, 404);
  }

  const state = await job.getState();

  if (state === "completed") {
    return c.json({
      status: "completed",
      job_id: jobId,
      result: job.returnvalue,
    });
  }

  if (state === "failed") {
    return c.json({
      status: "failed",
      job_id: jobId,
      error: job.failedReason ?? "Unknown error",
    });
  }

  return c.json({
    status: state, // "waiting" | "active" | "delayed"
    job_id: jobId,
    poll: `/v1/jobs/${jobId}`,
  });
});

export default app;
