/** Audit routes:
 *    GET /v1/vault/audit          — full project-wide audit log (most recent first)
 *    GET /v1/vault/:name/audit    — audit log scoped to one secret name */

import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";

import type { ProjectContext } from "../../auth/middleware";
import { db } from "../../db/client";
import { vaultAudit } from "../../db/schema/vault";

const app = new Hono<ProjectContext>();

// Project-wide. Mounted before the /:name route so it doesn't get treated
// as a secret named "audit".
app.get("/audit", async (c) => {
  const project = c.var.project;
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

// Per-secret audit log.
app.get("/:name/audit", async (c) => {
  const project = c.var.project;
  const name = c.req.param("name");
  const limit = Math.min(Number(c.req.query("limit") ?? "100"), 500);

  const entries = await db
    .select()
    .from(vaultAudit)
    .where(
      and(eq(vaultAudit.projectId, project.id), eq(vaultAudit.secretName, name)),
    )
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

export default app;
