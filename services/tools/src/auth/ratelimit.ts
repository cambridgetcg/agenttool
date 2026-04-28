/** Per-plan rate limiting using Redis sliding window. */

import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import Redis from "ioredis";

import { config, type Plan } from "../config";

let redis: Redis | null = null;

function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 3 });
  }
  return redis;
}

/**
 * Rate limit middleware — sliding window per project.
 * Limits are defined per plan in config.plans.
 */
export async function rateLimitMiddleware(c: Context<{ Variables: { project: any } }>, next: Next) {
  const project = c.var.project;
  if (!project) return next(); // skip if no auth (e.g., public endpoints)

  const plan = project.plan as Plan;
  const limit = config.plans[plan]?.ratePerMin ?? 10;
  const key = `ratelimit:${project.id}`;
  const now = Date.now();
  const windowMs = 60_000;

  const r = getRedis();

  // Sliding window: remove old entries, add current, count
  const multi = r.multi();
  multi.zremrangebyscore(key, 0, now - windowMs);
  multi.zadd(key, now, `${now}:${Math.random()}`);
  multi.zcard(key);
  multi.expire(key, 120);

  const results = await multi.exec();
  const count = results?.[2]?.[1] as number;

  if (count > limit) {
    throw new HTTPException(429, {
      message: `Rate limit exceeded. Plan "${plan}" allows ${limit} requests/minute.`,
    });
  }

  c.header("X-RateLimit-Limit", String(limit));
  c.header("X-RateLimit-Remaining", String(Math.max(0, limit - count)));

  return next();
}
