/** BullMQ worker that processes browser jobs. */

import { Worker } from "bullmq";
import { redisConnection } from "./connection";
import type { BrowseJobData, BrowseJobResult } from "./browse-queue";
import { initPool, acquireContext, releaseContext, navigatePage, destroyPool } from "../tools/browser/pool";
import { executeActions, extractContent, takeScreenshot } from "../tools/browser/actions";

let worker: Worker<BrowseJobData, BrowseJobResult> | null = null;

/** Start the browser worker. */
export async function startBrowseWorker(concurrency = 5): Promise<void> {
  await initPool();

  worker = new Worker<BrowseJobData, BrowseJobResult>(
    "browse",
    async (job) => {
      const start = Date.now();
      const { url, actions, extract, screenshot, timeout } = job.data;

      const ctx = await acquireContext();
      try {
        const page = await navigatePage(ctx, url, timeout ?? 30_000);

        // Execute actions if provided
        if (actions?.length) {
          await executeActions(page, actions);
        }

        // Extract content
        const content = await extractContent(page, extract ?? "text");

        // Screenshot if requested
        const screenshotBase64 = screenshot ? await takeScreenshot(page) : undefined;

        const title = await page.title();
        const finalUrl = page.url();

        return {
          url: finalUrl,
          title,
          content,
          extracted: content,
          screenshotBase64,
          durationMs: Date.now() - start,
        };
      } finally {
        await releaseContext(ctx);
      }
    },
    {
      connection: redisConnection,
      concurrency,
      limiter: {
        max: 10,
        duration: 60_000, // 10 jobs per minute max
      },
    },
  );

  worker.on("completed", (job) => {
    console.log(`✅ browse job ${job.id} completed in ${job.returnvalue?.durationMs}ms`);
  });

  worker.on("failed", (job, err) => {
    console.error(`❌ browse job ${job?.id} failed: ${err.message}`);
  });

  console.log(`🔧 Browse worker started (concurrency: ${concurrency})`);
}

/** Stop the browser worker gracefully. */
export async function stopBrowseWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
  await destroyPool();
  console.log("🔧 Browse worker stopped");
}
