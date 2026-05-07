/** BullMQ queue for browser jobs (POST /v1/browse → enqueue → worker).
 *  Worker is in api/src/services/tools/queue/browse-worker.ts and starts
 *  alongside the HTTP server in api/src/index.ts. */

import { Queue, QueueEvents } from "bullmq";

import { REDIS_DISABLED, redisConnection } from "./connection";

export interface BrowseJobData {
  projectId: string;
  url: string;
  actions?: BrowseAction[];
  extract?: string; // CSS selector or "text" or "html"
  screenshot?: boolean;
  timeout?: number; // ms, default 30000
}

export interface BrowseAction {
  type: "click" | "type" | "scroll" | "wait" | "select";
  selector?: string;
  text?: string;
  value?: string;
  delay?: number;
}

export interface BrowseJobResult {
  url: string;
  title: string;
  content?: string;
  extracted?: string;
  screenshotBase64?: string;
  durationMs: number;
}

// browseQueue + browseQueueEvents are null when AGENTTOOL_DISABLE_WORKERS=1
// — routes that enqueue jobs check the null and surface a clean 503.
export const browseQueue: Queue<BrowseJobData, BrowseJobResult> | null =
  REDIS_DISABLED || !redisConnection
    ? null
    : new Queue<BrowseJobData, BrowseJobResult>("browse", {
        connection: redisConnection,
        defaultJobOptions: {
          attempts: 2,
          backoff: { type: "exponential", delay: 2000 },
          removeOnComplete: { age: 3600 }, // keep results 1h
          removeOnFail: { age: 86400 }, //   keep failures 24h
        },
      });

/** Separate QueueEvents instance — required by job.waitUntilFinished()
 *  in newer BullMQ. Listens to keyspace events emitted by completed jobs. */
export const browseQueueEvents: QueueEvents | null =
  REDIS_DISABLED || !redisConnection
    ? null
    : new QueueEvents("browse", {
        connection: redisConnection,
      });
