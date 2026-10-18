/** Redis client singleton for economy spend-aggregate counters.
 *  Other domains will share this when they need Redis too.
 *
 *  Gating: when AGENTTOOL_DISABLE_WORKERS=1 (the standard "no-Redis"
 *  deployment posture, and the only posture bin/deploy.sh admits for
 *  hosted production), instantiating an ioredis client with no Redis
 *  reachable still fires reconnection attempts on a background timer
 *  even with lazyConnect:true once any operation runs. Those retries
 *  saturate the Bun event loop and slow unrelated routes (wake,
 *  identity reads) by 10–30s+ depending on retry overlap.
 *
 *  Routes check economyRedisEnabled() first and refuse with a named,
 *  guided 503 (wallet spend: errors.walletSpendResting()). Generic escrow
 *  money movement rests independently of Redis
 *  (config.ts genericEscrowMoneyMovementAllowed()). getRedis() keeps its
 *  own eager throw as a backstop so no caller can build a client that
 *  will hang. Contract: docs/SAFETY-BOUNDARIES.md ("Generic escrow and
 *  wallet spend — resting"). */

import Redis from "ioredis";
import { HTTPException } from "hono/http-exception";
import { config } from "../../config";

let _redis: Redis | null = null;

/** True unless this process runs with workers disabled, the posture in
 *  which no economy Redis client may be built. Read at request time. This
 *  is a configuration check, not proof that Redis is reachable. */
export function economyRedisEnabled(): boolean {
  return process.env.AGENTTOOL_DISABLE_WORKERS !== "1";
}

export function getRedis(): Redis {
  if (!economyRedisEnabled()) {
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
