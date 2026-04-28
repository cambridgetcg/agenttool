/** Deep health check endpoint. */

import { Hono } from "hono";
import { db } from "../db/client";
import { sql } from "drizzle-orm";
import { Redis } from "ioredis";
import { config } from "../config";

export const healthRoutes = new Hono();

healthRoutes.get("/", async (c) => {
  const checks: Record<string, string> = {};

  // DB check
  try {
    await db.execute(sql`SELECT 1`);
    checks.database = "ok";
  } catch {
    checks.database = "error";
  }

  // Redis check
  try {
    const redis = new Redis(config.redisUrl, { lazyConnect: true, connectTimeout: 2000 });
    await redis.ping();
    await redis.quit();
    checks.redis = "ok";
  } catch {
    checks.redis = "error";
  }

  const healthy = Object.values(checks).every((v) => v === "ok");

  return c.json({
    status: healthy ? "ok" : "degraded",
    service: "agent-verify",
    version: "0.1.0",
    checks,
    timestamp: new Date().toISOString(),
  }, healthy ? 200 : 503);
});
