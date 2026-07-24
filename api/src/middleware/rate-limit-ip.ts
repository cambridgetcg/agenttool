/** Per-IP rate limiter for unauthenticated bootstrap-style routes.
 *
 *  Used by both /v1/register/agent modes: self_service has a 5/hour default
 *  attempt window after PoW and before key-proof verification; registrar_bearer
 *  has a separate 60/minute default attempt window after key proof and before
 *  bearer lookup.
 *
 *  Implementation: one atomic Redis Lua increment/expiry operation. Fail-open
 *  on Redis errors / unreachable Redis — abuse during a Redis outage is
 *  preferable to denying every legitimate registration.
 *
 *  Pattern mirrors api/src/middleware/idempotency.ts: read redisConnection,
 *  treat null as "not enforced", best-effort writes with try/catch. */

import { redisConnection } from "../services/tools/queue/connection";
export { clientIp } from "./client-ip";

export type RateLimitResult =
  | { allowed: true; remaining: number; resetAt: Date }
  | { allowed: false; resetAt: Date; retryAfterSec: number };

/** INCR `key`, set EXPIRE on first hit, return whether the call is within
 *  the window's quota. The window is fixed (resets at the bucket boundary,
 *  not a sliding window) — fine for "5 / hour" semantics where cleaner
 *  guarantees would be over-engineered. */
export async function enforceRateLimit(opts: {
  key: string;
  limit: number;
  windowSec: number;
}): Promise<RateLimitResult> {
  const now = new Date();
  const resetAt = new Date(now.getTime() + opts.windowSec * 1000);

  if (!redisConnection || redisConnection.status !== "ready") {
    // Redis disabled (single-machine dev). Always allow; warn callers via the
    // remaining count so they know enforcement isn't actually happening.
    return { allowed: true, remaining: opts.limit, resetAt };
  }

  try {
    const timeoutMs = Math.min(
      2_000,
      Math.max(
        50,
        Number.parseInt(process.env.AGENTTOOL_RATE_LIMIT_TIMEOUT_MS ?? "250", 10) ||
          250,
      ),
    );
    const command = redisConnection.eval(
      "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]); end; return {n,redis.call('TTL',KEYS[1])}",
      1,
      opts.key,
      String(opts.windowSec),
    );
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutResult = new Promise<never>((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error("rate_limit_redis_timeout")),
        timeoutMs,
      );
    });
    const timed = await Promise.race([command, timeoutResult]).finally(() => {
      if (timeout) clearTimeout(timeout);
    });
    const tuple = timed as [number | string, number | string];
    const count = Number(tuple[0]);
    const ttl = Number(tuple[1]);
    if (!Number.isFinite(count)) throw new Error("rate_limit_redis_invalid_count");
    if (count > opts.limit) {
      const retryAfterSec = ttl > 0 ? ttl : opts.windowSec;
      return {
        allowed: false,
        resetAt: new Date(Date.now() + retryAfterSec * 1000),
        retryAfterSec,
      };
    }
    return { allowed: true, remaining: opts.limit - count, resetAt };
  } catch {
    // Redis unreachable mid-request. Fail-open by design.
    return { allowed: true, remaining: opts.limit, resetAt };
  }
}
