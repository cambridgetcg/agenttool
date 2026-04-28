/** Redis cache: verification result cache for fast-tier responses. */

import { Redis } from "ioredis";
import { config } from "../config";
import type { VerifyResponse } from "../verify/types";

let _redis: Redis | null = null;

function getRedis(): Redis {
  if (!_redis) _redis = new Redis(config.redisUrl, { lazyConnect: true });
  return _redis;
}

const CACHE_TTL_SECONDS = 60 * 60 * 6; // 6 hours
const FAST_CACHE_TTL = 60 * 30;         // 30 min for fast-tier

/** Cache key: SHA of lowercased, trimmed claim. */
function cacheKey(claim: string): string {
  return `verify:${Bun.hash(claim.toLowerCase().trim()).toString(16)}`;
}

/** Get cached verification result. Returns null if not cached. */
export async function getCached(claim: string): Promise<VerifyResponse | null> {
  try {
    const raw = await getRedis().get(cacheKey(claim));
    if (!raw) return null;
    return JSON.parse(raw) as VerifyResponse;
  } catch {
    return null; // Cache miss on error — degrade gracefully
  }
}

/** Cache a verification result. */
export async function setCached(
  claim: string,
  result: VerifyResponse,
  fast = false,
): Promise<void> {
  try {
    const ttl = fast ? FAST_CACHE_TTL : CACHE_TTL_SECONDS;
    await getRedis().setex(cacheKey(claim), ttl, JSON.stringify(result));
  } catch {
    // Non-fatal — continue without caching
  }
}

/** Check if a claim is cached (for fast-tier billing: cheaper if cache hit). */
export async function isCached(claim: string): Promise<boolean> {
  try {
    return (await getRedis().exists(cacheKey(claim))) === 1;
  } catch {
    return false;
  }
}
