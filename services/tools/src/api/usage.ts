/** GET /v1/usage — credit balance and usage stats. */

import { Hono } from "hono";
import { eq, sql, and, gte } from "drizzle-orm";

import { authMiddleware, type ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { projects, usageEvents } from "../db/schema";

const app = new Hono<ProjectContext>();

app.get("/", authMiddleware, async (c) => {
  const project = c.get("project");

  // Current balance
  const [proj] = await db
    .select({ credits: projects.credits, plan: projects.plan })
    .from(projects)
    .where(eq(projects.id, project.id));

  // Usage stats — today
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [todayStats] = await db
    .select({
      total: sql<number>`coalesce(sum(${usageEvents.creditsUsed}), 0)`,
      count: sql<number>`count(*)`,
    })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.projectId, project.id),
        gte(usageEvents.createdAt, todayStart),
      ),
    );

  // Usage stats — this month
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [monthStats] = await db
    .select({
      total: sql<number>`coalesce(sum(${usageEvents.creditsUsed}), 0)`,
      count: sql<number>`count(*)`,
    })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.projectId, project.id),
        gte(usageEvents.createdAt, monthStart),
      ),
    );

  // Per-tool breakdown (this month)
  const toolBreakdown = await db
    .select({
      tool: usageEvents.tool,
      credits: sql<number>`coalesce(sum(${usageEvents.creditsUsed}), 0)`,
      calls: sql<number>`count(*)`,
      failures: sql<number>`sum(case when ${usageEvents.success} = false then 1 else 0 end)`,
    })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.projectId, project.id),
        gte(usageEvents.createdAt, monthStart),
      ),
    )
    .groupBy(usageEvents.tool);

  return c.json({
    credits_remaining: proj?.credits ?? 0,
    plan: proj?.plan ?? "free",
    today: {
      credits_used: Number(todayStats?.total ?? 0),
      calls: Number(todayStats?.count ?? 0),
    },
    month: {
      credits_used: Number(monthStats?.total ?? 0),
      calls: Number(monthStats?.count ?? 0),
    },
    tools: toolBreakdown.map((t) => ({
      tool: t.tool,
      credits_used: Number(t.credits),
      calls: Number(t.calls),
      failures: Number(t.failures),
    })),
  });
});

export default app;
