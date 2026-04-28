/** GET /health — system health check (DB + Redis + queue status). No auth required. */

import { Hono } from "hono";
import { db } from "../db/client";
import { sql } from "drizzle-orm";
import Redis from "ioredis";
import { config } from "../config";

const app = new Hono();

app.get("/health", async (c) => {
  const checks: Record<string, { status: string; latencyMs?: number; error?: string }> = {};
  let allHealthy = true;

  // PostgreSQL
  try {
    const start = performance.now();
    await db.execute(sql`SELECT 1`);
    checks.postgres = { status: "ok", latencyMs: Math.round(performance.now() - start) };
  } catch (e) {
    checks.postgres = { status: "error", error: String(e) };
    allHealthy = false;
  }

  // Redis
  try {
    const start = performance.now();
    const redis = new Redis(config.redisUrl, { lazyConnect: true, connectTimeout: 2000 });
    await redis.connect();
    await redis.ping();
    checks.redis = { status: "ok", latencyMs: Math.round(performance.now() - start) };
    await redis.quit();
  } catch (e) {
    checks.redis = { status: "error", error: String(e) };
    allHealthy = false;
  }

  return c.json(
    {
      status: allHealthy ? "healthy" : "degraded",
      version: "0.1.0",
      checks,
      timestamp: new Date().toISOString(),
    },
    allHealthy ? 200 : 503,
  );
});

export default app;
