/** Redis client singleton for economy spend-aggregate counters.
 *  Other domains will share this when they need Redis too. */

import Redis from "ioredis";
import { config } from "../../config";

let _redis: Redis | null = null;

export function getRedis(): Redis {
  if (!_redis) {
    _redis = new Redis(config.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 3,
    });
  }
  return _redis;
}
