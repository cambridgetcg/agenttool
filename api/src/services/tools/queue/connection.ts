/** Shared IORedis connection for BullMQ + cache. */

import IORedis from "ioredis";

import { toolsConfig } from "../config";

export const redisConnection = new IORedis(toolsConfig.redisUrl, {
  maxRetriesPerRequest: null, // required by BullMQ
  enableReadyCheck: false,
  lazyConnect: true,
});
