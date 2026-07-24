/** Small fixed-window limits for the public MCP compatibility endpoint.
 *
 * The limiter is deliberately process-local: it has no Redis dependency and
 * cannot silently fail open. Every instance has a hard key cap. Once that cap
 * is full, untracked callers share one overflow bucket; key churn therefore
 * cannot erase a live caller's enforcement history.
 *
 * Doctrine: docs/ALIGNMENT-MOVES.md (Move 1).
 */

export interface FixedWindowLimitOptions {
  limit: number;
  windowMs: number;
  maxKeys: number;
}

export type FixedWindowDecision =
  | { allowed: true; remaining: number; resetAtMs: number }
  | { allowed: false; retryAfterSec: number; resetAtMs: number };

export interface FixedWindowLimiter {
  take(key: string, nowMs?: number): FixedWindowDecision;
  reset(): void;
  size(): number;
}

interface Bucket {
  used: number;
  resetAtMs: number;
}

/** Pure factory with explicit time injection and reset, suitable for hermetic
 * tests. The returned limiter keeps at most maxKeys keyed buckets plus one
 * shared overflow bucket whose memory use does not grow with caller churn. */
export function createFixedWindowLimiter(
  options: FixedWindowLimitOptions,
): FixedWindowLimiter {
  if (
    !Number.isInteger(options.limit) ||
    options.limit < 1 ||
    !Number.isInteger(options.windowMs) ||
    options.windowMs < 1 ||
    !Number.isInteger(options.maxKeys) ||
    options.maxKeys < 1
  ) {
    throw new Error("invalid_fixed_window_limit_options");
  }

  const buckets = new Map<string, Bucket>();
  let overflowBucket: Bucket | undefined;

  function removeExpired(nowMs: number): void {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAtMs <= nowMs) buckets.delete(key);
    }
    if (overflowBucket && overflowBucket.resetAtMs <= nowMs) {
      overflowBucket = undefined;
    }
  }

  return {
    take(key: string, nowMs: number = Date.now()): FixedWindowDecision {
      let bucket = buckets.get(key);
      if (bucket && bucket.resetAtMs <= nowMs) {
        buckets.delete(key);
        bucket = undefined;
      }

      if (!bucket) {
        removeExpired(nowMs);
        if (buckets.size >= options.maxKeys) {
          overflowBucket ??= {
            used: 0,
            resetAtMs: nowMs + options.windowMs,
          };
          bucket = overflowBucket;
        } else {
          bucket = { used: 0, resetAtMs: nowMs + options.windowMs };
          buckets.set(key, bucket);
        }
      }

      if (bucket.used >= options.limit) {
        return {
          allowed: false,
          retryAfterSec: Math.max(
            1,
            Math.ceil((bucket.resetAtMs - nowMs) / 1000),
          ),
          resetAtMs: bucket.resetAtMs,
        };
      }

      bucket.used += 1;
      return {
        allowed: true,
        remaining: options.limit - bucket.used,
        resetAtMs: bucket.resetAtMs,
      };
    },

    reset(): void {
      buckets.clear();
      overflowBucket = undefined;
    },

    size(): number {
      return buckets.size;
    },
  };
}

export const PUBLIC_MCP_REQUEST_LIMIT = {
  limit: 240,
  windowMs: 60_000,
  maxKeys: 2_048,
} as const;

export const PUBLIC_MCP_TOOL_LIMIT = {
  limit: 60,
  windowMs: 60_000,
  maxKeys: 2_048,
} as const;

const requestLimiter = createFixedWindowLimiter(PUBLIC_MCP_REQUEST_LIMIT);
const toolLimiter = createFixedWindowLimiter(PUBLIC_MCP_TOOL_LIMIT);

export function takePublicMcpLimit(
  kind: "request" | "tool",
  key: string,
  nowMs?: number,
): FixedWindowDecision {
  return (kind === "request" ? requestLimiter : toolLimiter).take(key, nowMs);
}

export function resetPublicMcpLimitsForTests(): void {
  requestLimiter.reset();
  toolLimiter.reset();
}
