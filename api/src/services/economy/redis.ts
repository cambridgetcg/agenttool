/** Redis client singleton for economy spend-aggregate counters.
 *  Other domains will share this when they need Redis too.
 *
 *  Gating: when AGENTTOOL_DISABLE_WORKERS=1 (the standard "no-Redis"
 *  deployment posture), instantiating an ioredis client with no Redis
 *  reachable still fires reconnection attempts on a background timer
 *  even with lazyConnect:true once any operation runs. Those retries
 *  saturate the Bun event loop and slow unrelated routes (wake,
 *  identity reads) by 10–30s+ depending on retry overlap.
 *
 *  When workers are disabled we throw a 503-style error eagerly rather
 *  than instantiating a client that will hang. Wallet + escrow routes
 *  surface the right HTTP status instead of timing out. */

import Redis from "ioredis";
import { HTTPException } from "hono/http-exception";
import { config } from "../../config";

let _redis: Redis | null = null;

export function getRedis(): Redis {
  if (process.env.AGENTTOOL_DISABLE_WORKERS === "1") {
    throw new HTTPException(503, {
      message:
        "redis_disabled — set REDIS_URL and unset AGENTTOOL_DISABLE_WORKERS to enable spend-aggregate counters and escrow operations",
    });
  }
  if (!_redis) {
    _redis = new Redis(config.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      // Don't sit in retry loops on an unreachable host — fail fast.
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 1000)),
      reconnectOnError: () => false,
    });
  }
  return _redis;
}
