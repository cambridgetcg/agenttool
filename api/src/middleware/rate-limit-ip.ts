/** Per-IP rate limiter for unauthenticated bootstrap-style routes.
 *
 *  Used by /v1/register/agent self_service mode to cap how many agents a
 *  single IP can spawn per hour. The signed-bearer flow is unaffected.
 *
 *  Implementation: Redis INCR + EXPIRE on a one-hour bucket key. Fail-open
 *  on Redis errors / unreachable Redis — abuse during a Redis outage is
 *  preferable to denying every legitimate registration.
 *
 *  Pattern mirrors api/src/middleware/idempotency.ts: read redisConnection,
 *  treat null as "not enforced", best-effort writes with try/catch. */

import { redisConnection } from "../services/tools/queue/connection";

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

  if (!redisConnection) {
    // Redis disabled (single-machine dev). Always allow; warn callers via the
    // remaining count so they know enforcement isn't actually happening.
    return { allowed: true, remaining: opts.limit, resetAt };
  }

  try {
    const count = await redisConnection.incr(opts.key);
    if (count === 1) {
      await redisConnection.expire(opts.key, opts.windowSec);
    }
    if (count > opts.limit) {
      const ttl = await redisConnection.ttl(opts.key);
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

/** Extract a stable IP for rate-limit keying. Honours x-forwarded-for and
 *  cf-connecting-ip when present (standard at our edge); falls back to the
 *  direct socket address. Returns "unknown" when nothing usable is found —
 *  the empty bucket is shared, which is fine: the goal is rough rate-limit,
 *  not per-attacker tracking. */
export function clientIp(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const xri = req.headers.get("x-real-ip");
  if (xri) return xri.trim();
  return "unknown";
}
