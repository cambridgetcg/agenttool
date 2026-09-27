/** /v1/vault/:name/policy — manage which agent_ids can read this secret. */

import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../../auth/middleware";
import { db } from "../../db/client";
import { vaultAudit, vaultSecrets } from "../../db/schema/vault";
import { validateVaultAudience, vaultAudienceSchema } from "../../services/vault/audience";

const app = new Hono<ProjectContext>();

const policySchema = z.object({
  agent_ids: vaultAudienceSchema,
});

// PUT /:name/policy — set agent_ids policy.
app.put("/:name/policy", async (c) => {
  const project = c.var.project;
  const name = c.req.param("name");
  const body = policySchema.parse(await c.req.json());
  const audience = await validateVaultAudience(project.id, body.agent_ids);
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
    .set({ agentIds: audience, updatedAt: new Date() })
    .where(eq(vaultSecrets.id, secret.id));

  await db.insert(vaultAudit).values({
    projectId: project.id,
    secretName: name,
    action: "policy_change",
    agentId: null, // Project administration is not an authenticated identity action.
    ipAddress: ip,
  });

  return c.json({ name, agent_ids: audience });
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
