/** BullMQ queue for browser jobs. */

import { Queue } from "bullmq";
import { redisConnection } from "./connection";

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

export const browseQueue = new Queue<BrowseJobData, BrowseJobResult>("browse", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: { age: 3600 }, // keep results 1h
    removeOnFail: { age: 86400 },    // keep failures 24h
  },
});
