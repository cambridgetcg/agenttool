/** BullMQ worker that processes browse jobs.
 *
 *  Started in-process from api/src/index.ts via startBrowseWorker(). Handles
 *  Playwright lifecycle (lazy init), action execution, content extraction,
 *  optional screenshot. */

import { Worker } from "bullmq";

import { toolsConfig } from "../config";
import {
  acquireContext,
  navigatePage,
  releaseContext,
} from "../browser/pool";
import {
  executeActions,
  extractContent,
  takeScreenshot,
} from "../browser/actions";
import type {
  BrowseJobData,
  BrowseJobResult,
} from "./browse-queue";
import { redisConnection } from "./connection";

let worker: Worker<BrowseJobData, BrowseJobResult> | null = null;

export function startBrowseWorker() {
  if (worker) return worker;

  worker = new Worker<BrowseJobData, BrowseJobResult>(
    "browse",
    async (job) => {
      const start = Date.now();
      const data = job.data;

      const ctx = await acquireContext();
      try {
        const page = await navigatePage(ctx, data.url, data.timeout ?? 30_000);

        if (data.actions && data.actions.length > 0) {
          await executeActions(page, data.actions);
        }

        const title = await page.title();
        const content = data.extract ? undefined : await page.innerText("body");
        const extracted = await extractContent(page, data.extract);
        const screenshotBase64 = data.screenshot
          ? await takeScreenshot(page)
          : undefined;

        return {
          url: data.url,
          title,
          content,
          extracted,
          screenshotBase64,
          durationMs: Date.now() - start,
        };
      } finally {
        await releaseContext(ctx);
      }
    },
    {
      connection: redisConnection,
      concurrency: toolsConfig.browseConcurrency,
    },
  );

  worker.on("error", (err) => {
    console.error("[browse-worker] error:", err);
  });

  console.log(
    `🤖 browse worker started (concurrency=${toolsConfig.browseConcurrency})`,
  );

  return worker;
}

export async function stopBrowseWorker() {
  if (worker) {
    await worker.close();
    worker = null;
  }
}
