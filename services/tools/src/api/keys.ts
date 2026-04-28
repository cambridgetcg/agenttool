/** API key management — list, create, revoke. Requires auth. */

import { Hono } from "hono";
import { eq, isNull, and } from "drizzle-orm";

import { db } from "../db/client";
import { apiKeys } from "../db/schema";
import { generateApiKey } from "../auth/keys";
import { authMiddleware, type ProjectContext } from "../auth/middleware";

const router = new Hono<ProjectContext>();

// All key management requires auth
router.use("*", authMiddleware);

/**
 * GET / — list all active (non-revoked) keys for the project.
 * Returns prefix + name + created_at + last_used (never the full key).
 */
router.get("/", async (c) => {
  const project = c.var.project;

  const keys = await db
    .select({
      id: apiKeys.id,
      keyPrefix: apiKeys.keyPrefix,
      name: apiKeys.name,
      createdAt: apiKeys.createdAt,
      lastUsed: apiKeys.lastUsed,
    })
    .from(apiKeys)
    .where(and(eq(apiKeys.projectId, project.id), isNull(apiKeys.revokedAt)));

  return c.json({ keys });
});

/**
 * POST / — create a new API key for this project.
 * Body: { name?: string }
 * Returns the plaintext key (shown once).
 */
router.post("/", async (c) => {
  const project = c.var.project;
  const body = await c.req.json<{ name?: string }>().catch(() => ({}));

  const { key, keyHash, keyPrefix } = generateApiKey();

  const [created] = await db
    .insert(apiKeys)
    .values({
      projectId: project.id,
      keyHash,
      keyPrefix,
      name: body.name ?? null,
    })
    .returning();

  return c.json(
    {
      id: created.id,
      key_prefix: created.keyPrefix,
      name: created.name,
      api_key: key, // shown once
      created_at: created.createdAt,
    },
    201,
  );
});

/**
 * DELETE /:keyId — revoke a key by ID.
 * Soft delete (sets revoked_at).
 */
router.delete("/:keyId", async (c) => {
  const project = c.var.project;
  const keyId = c.req.param("keyId");

  const [revoked] = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.projectId, project.id), isNull(apiKeys.revokedAt)))
    .returning();

  if (!revoked) {
    return c.json({ error: "Key not found or already revoked" }, 404);
  }

  return c.json({ revoked: true, id: revoked.id });
});

export default router;
