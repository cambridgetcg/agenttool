/** Shared IORedis connection for BullMQ + idempotency cache.
 *
 *  When AGENTTOOL_DISABLE_WORKERS=1 (the standard "no Redis available"
 *  posture for dev / staging / single-machine prod) we never instantiate
 *  the client. Routes that need Redis check IS_DISABLED first; modules
 *  that import this file at startup (browse-queue, idempotency) get
 *  null and gate their own usage. Prevents the runaway-reconnection
 *  storm that otherwise saturates the Bun event loop when localhost
 *  Redis isn't reachable. */

import IORedis from "ioredis";

import { toolsConfig } from "../config";

export const REDIS_DISABLED = process.env.AGENTTOOL_DISABLE_WORKERS === "1";

export const redisConnection: IORedis | null = REDIS_DISABLED
  ? null
  : new IORedis(toolsConfig.redisUrl, {
      maxRetriesPerRequest: null, // required by BullMQ
      enableReadyCheck: false,
      lazyConnect: true,
    });
