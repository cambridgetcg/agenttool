/** GET /v1/jobs/:id — poll async job results. */

import { Hono } from "hono";
import { browseQueue } from "../queue/browse-queue";
import type { ProjectContext } from "../auth/middleware";

const jobsApp = new Hono<ProjectContext>();

jobsApp.get("/:id", async (c) => {
  const jobId = c.req.param("id");

  const job = await browseQueue.getJob(jobId);
  if (!job) {
    return c.json({ error: "Job not found" }, 404);
  }

  // Verify job belongs to this project
  if (job.data.projectId !== c.get("project").id) {
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

export { jobsApp };

export default jobsApp;
