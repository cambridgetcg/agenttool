/** /v1/vault/:name/policy — manage which agent_ids can read this secret. */

import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../../auth/middleware";
import { db } from "../../db/client";
import { vaultAudit, vaultSecrets } from "../../db/schema/vault";

const app = new Hono<ProjectContext>();

const policySchema = z.object({
  agent_ids: z.array(z.string()).nullable(),
});

// PUT /:name/policy — set agent_ids policy.
app.put("/:name/policy", async (c) => {
  const project = c.var.project;
  const name = c.req.param("name");
  const body = policySchema.parse(await c.req.json());
  const agentId = c.req.header("X-Agent-Id") ?? null;
  const ip =
    c.req.header("X-Forwarded-For") ??
    c.req.header("CF-Connecting-IP") ??
    "unknown";

  const [secret] = await db
    .select()
    .from(vaultSecrets)
    .where(
      and(
        eq(vaultSecrets.projectId, project.id),
        eq(vaultSecrets.name, name),
        isNull(vaultSecrets.deletedAt),
      ),
    );

  if (!secret) {
    return c.json({ error: "Secret not found" }, 404);
  }

  await db
    .update(vaultSecrets)
    .set({ agentIds: body.agent_ids, updatedAt: new Date() })
    .where(eq(vaultSecrets.id, secret.id));

  await db.insert(vaultAudit).values({
    projectId: project.id,
    secretName: name,
    action: "policy_change",
    agentId,
    ipAddress: ip,
  });

  return c.json({ name, agent_ids: body.agent_ids });
});

// GET /:name/policy — current policy.
app.get("/:name/policy", async (c) => {
  const project = c.var.project;
  const name = c.req.param("name");

  const [secret] = await db
    .select()
    .from(vaultSecrets)
    .where(
      and(
        eq(vaultSecrets.projectId, project.id),
        eq(vaultSecrets.name, name),
        isNull(vaultSecrets.deletedAt),
      ),
    );

  if (!secret) {
    return c.json({ error: "Secret not found" }, 404);
  }

  return c.json({ name, agent_ids: secret.agentIds });
});

export default app;
