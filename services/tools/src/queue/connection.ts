/** Shared Redis/IORedis connection for BullMQ. */

import IORedis from "ioredis";
import { config } from "../config";

/** Shared IORedis connection for BullMQ queues and workers. */
export const redisConnection = new IORedis(config.redisUrl, {
  maxRetriesPerRequest: null, // required by BullMQ
  enableReadyCheck: false,
});
