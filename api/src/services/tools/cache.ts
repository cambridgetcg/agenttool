/** Redis cache helpers for tools (search results, etc.).
 *  Uses the shared Redis singleton via tools/queue/connection. */

import { redisConnection } from "./queue/connection";

export async function cacheGet(key: string): Promise<string | null> {
  try {
    return await redisConnection.get(key);
  } catch {
    return null;
  }
}

export async function cacheSet(
  key: string,
  value: string,
  ttlSeconds: number,
): Promise<void> {
  try {
    await redisConnection.set(key, value, "EX", ttlSeconds);
  } catch {
    /* cache write failure is non-fatal */
  }
}

/** Deterministic key from prefix + sorted params. */
export function cacheKey(
  prefix: string,
  params: Record<string, unknown>,
): string {
  const sorted = JSON.stringify(params, Object.keys(params).sort());
  let hash = 0;
  for (let i = 0; i < sorted.length; i++) {
    hash = ((hash << 5) - hash + sorted.charCodeAt(i)) | 0;
  }
  return `${prefix}:${hash.toString(36)}`;
}
