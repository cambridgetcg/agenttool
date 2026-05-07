/** GET /v1/jobs/:id — poll async job results (currently: browse).
 *
 *  Two modes:
 *    GET /v1/jobs/:id              — JSON snapshot (existing behavior)
 *    GET /v1/jobs/:id?stream=true  — Server-Sent Events stream:
 *        event: progress  data: <progress payload>
 *        event: complete  data: {id, result}
 *        event: failed    data: {id, reason}
 *
 *  The SSE stream emits the current state immediately (so a connect-late
 *  client doesn't miss completion), then subscribes to BullMQ QueueEvents
 *  for live updates until the job terminates or 60s elapses. */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import type { ProjectContext } from "../../auth/middleware";
import {
  browseQueue,
  browseQueueEvents,
} from "../../services/tools/queue/browse-queue";

const app = new Hono<ProjectContext>();

const STREAM_MAX_MS = 60_000;

app.get("/:id", async (c) => {
  if (!browseQueue) {
    return c.json({ error: "redis_disabled", message: "browse jobs disabled (AGENTTOOL_DISABLE_WORKERS=1)" }, 503);
  }
  const jobId = c.req.param("id");
  const wantsStream = c.req.query("stream") === "true";

  const job = await browseQueue.getJob(jobId);
  if (!job || job.data.projectId !== c.var.project.id) {
    if (wantsStream) {
      return streamSSE(c, async (sse) => {
        await sse.writeSSE({
          event: "error",
          data: JSON.stringify({ error: "job_not_found" }),
        });
      });
    }
    return c.json({ error: "job_not_found" }, 404);
  }

  // ── JSON snapshot (default) ─────────────────────────────────────────
  if (!wantsStream) {
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
      progress: job.progress,
      poll: `/v1/jobs/${jobId}`,
      stream: `/v1/jobs/${jobId}?stream=true`,
    });
  }

  // ── SSE stream ──────────────────────────────────────────────────────
  return streamSSE(c, async (sse) => {
    // Initial state — covers connect-after-completion case.
    const state = await job.getState();
    if (state === "completed") {
      await sse.writeSSE({
        event: "complete",
        data: JSON.stringify({ id: jobId, result: job.returnvalue }),
        id: jobId,
      });
      return;
    }
    if (state === "failed") {
      await sse.writeSSE({
        event: "failed",
        data: JSON.stringify({ id: jobId, reason: job.failedReason }),
        id: jobId,
      });
      return;
    }

    await sse.writeSSE({
      event: "state",
      data: JSON.stringify({ id: jobId, state, progress: job.progress }),
      id: jobId,
    });

    // Subscribe to BullMQ QueueEvents filtered by this job id.
    // Bind to a non-null local so the listener callbacks below type-check
    // (early-return at the top of this handler ensures browseQueueEvents
    // is non-null whenever we reach this point, but TS narrowing doesn't
    // carry across the closure boundary).
    if (!browseQueueEvents) return;
    const events = browseQueueEvents;
    let resolveStream!: () => void;
    const streamDone = new Promise<void>((resolve) => {
      resolveStream = resolve;
    });

    const matches = (eventJobId: string) => eventJobId === jobId;

    const onProgress = (args: { jobId: string; data: unknown }) => {
      if (!matches(args.jobId)) return;
      void sse.writeSSE({
        event: "progress",
        data: JSON.stringify(args.data),
        id: args.jobId,
      });
    };
    const onCompleted = (args: { jobId: string; returnvalue: string }) => {
      if (!matches(args.jobId)) return;
      void sse
        .writeSSE({
          event: "complete",
          data: args.returnvalue ?? "{}",
          id: args.jobId,
        })
        .finally(() => resolveStream());
    };
    const onFailed = (args: { jobId: string; failedReason: string }) => {
      if (!matches(args.jobId)) return;
      void sse
        .writeSSE({
          event: "failed",
          data: JSON.stringify({ id: args.jobId, reason: args.failedReason }),
          id: args.jobId,
        })
        .finally(() => resolveStream());
    };

    events.on("progress", onProgress);
    events.on("completed", onCompleted);
    events.on("failed", onFailed);

    sse.onAbort(() => resolveStream());

    try {
      const timeout = new Promise<void>((resolve) =>
        setTimeout(resolve, STREAM_MAX_MS),
      );
      await Promise.race([streamDone, timeout]);
    } finally {
      events.off("progress", onProgress);
      events.off("completed", onCompleted);
      events.off("failed", onFailed);
    }
  });
});

export default app;
