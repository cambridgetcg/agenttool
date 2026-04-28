/** Version routes: GET /v1/vault/:name/versions — list all versions of a secret. */

import { Hono } from "hono";
import { eq, and, isNull } from "drizzle-orm";

import type { ProjectContext } from "../auth/middleware.ts";
import { db } from "../db/client.ts";
import { vaultSecrets, vaultVersions } from "../db/schema.ts";

const app = new Hono<ProjectContext>();

// GET /v1/vault/:name/versions — list versions (no values)
app.get("/:name/versions", async (c) => {
  const project = c.get("project");
  const name = c.req.param("name");

  const [secret] = await db
    .select()
    .from(vaultSecrets)
    .where(and(eq(vaultSecrets.projectId, project.id), eq(vaultSecrets.name, name), isNull(vaultSecrets.deletedAt)));

  if (!secret) {
    return c.json({ error: "Secret not found" }, 404);
  }

  const versions = await db
    .select({
      version: vaultVersions.version,
      createdAt: vaultVersions.createdAt,
      expiresAt: vaultVersions.expiresAt,
      createdByAgent: vaultVersions.createdByAgent,
    })
    .from(vaultVersions)
    .where(eq(vaultVersions.secretId, secret.id))
    .orderBy(vaultVersions.version);

  return c.json({
    name,
    current_version: secret.currentVersion,
    versions: versions.map((v) => ({
      version: v.version,
      created_at: v.createdAt?.toISOString() ?? null,
      expires_at: v.expiresAt?.toISOString() ?? null,
      created_by_agent: v.createdByAgent,
    })),
  });
});

export default app;
