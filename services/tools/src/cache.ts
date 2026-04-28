/** Redis client + caching helpers. */

import Redis from "ioredis";
import { config } from "./config";

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
  }
  return redis;
}

/**
 * Get a cached value. Returns null on miss or Redis error.
 */
export async function cacheGet(key: string): Promise<string | null> {
  try {
    return await getRedis().get(key);
  } catch {
    return null;
  }
}

/**
 * Set a cached value with TTL in seconds.
 */
export async function cacheSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  try {
    await getRedis().set(key, value, "EX", ttlSeconds);
  } catch {
    // Cache write failure is non-fatal
  }
}

/**
 * Generate a deterministic cache key from prefix + params.
 */
export function cacheKey(prefix: string, params: Record<string, unknown>): string {
  const sorted = JSON.stringify(params, Object.keys(params).sort());
  // Simple hash — good enough for cache keys
  let hash = 0;
  for (let i = 0; i < sorted.length; i++) {
    hash = ((hash << 5) - hash + sorted.charCodeAt(i)) | 0;
  }
  return `${prefix}:${hash.toString(36)}`;
}
