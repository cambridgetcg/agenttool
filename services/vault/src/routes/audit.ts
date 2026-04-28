/** Audit routes: GET /v1/vault/:name/audit + GET /v1/vault/audit. */

import { Hono } from "hono";
import { eq, and, desc } from "drizzle-orm";

import type { ProjectContext } from "../auth/middleware.ts";
import { db } from "../db/client.ts";
import { vaultAudit } from "../db/schema.ts";

const app = new Hono<ProjectContext>();

// GET /v1/vault/:name/audit — audit log for a specific secret
app.get("/:name/audit", async (c) => {
  const project = c.get("project");
  const name = c.req.param("name");
  const limit = Math.min(Number(c.req.query("limit") ?? "100"), 500);

  const entries = await db
    .select()
    .from(vaultAudit)
    .where(and(eq(vaultAudit.projectId, project.id), eq(vaultAudit.secretName, name)))
    .orderBy(desc(vaultAudit.createdAt))
    .limit(limit);

  return c.json({
    entries: entries.map((e) => ({
      action: e.action,
      agent_id: e.agentId,
      ip: e.ipAddress,
      version: e.version,
      ts: e.createdAt?.toISOString() ?? null,
    })),
  });
});

// GET /v1/vault/audit — full audit log for project
app.get("/audit", async (c) => {
  const project = c.get("project");
  const limit = Math.min(Number(c.req.query("limit") ?? "100"), 500);

  const entries = await db
    .select()
    .from(vaultAudit)
    .where(eq(vaultAudit.projectId, project.id))
    .orderBy(desc(vaultAudit.createdAt))
    .limit(limit);

  return c.json({
    entries: entries.map((e) => ({
      secret_name: e.secretName,
      action: e.action,
      agent_id: e.agentId,
      ip: e.ipAddress,
      version: e.version,
      ts: e.createdAt?.toISOString() ?? null,
    })),
  });
});

export default app;
