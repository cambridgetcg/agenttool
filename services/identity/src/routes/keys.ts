/** Key management routes. */

import { Hono } from "hono";
import { eq, and, isNull } from "drizzle-orm";

import type { ProjectContext } from "../auth/middleware.ts";
import { db } from "../db/client.ts";
import { identities, identityKeys } from "../db/schema.ts";
import { generateKeypair } from "../services/crypto.ts";

const app = new Hono<ProjectContext>();

/** GET /v1/identities/:id/keys — List active keys for an identity. */
app.get("/", async (c) => {
  const identityId = c.req.param("id")!;

  const keys = await db
    .select({
      id: identityKeys.id,
      publicKey: identityKeys.publicKey,
      label: identityKeys.label,
      active: identityKeys.active,
      createdAt: identityKeys.createdAt,
      revokedAt: identityKeys.revokedAt,
    })
    .from(identityKeys)
    .where(eq(identityKeys.identityId, identityId));

  return c.json({
    keys: keys.map((k) => ({
      kid: k.id,
      public_key: k.publicKey,
      label: k.label,
      active: k.active,
      created_at: k.createdAt,
      revoked_at: k.revokedAt,
    })),
  });
});

/** POST /v1/identities/:id/keys — Add a new key (rotation). */
app.post("/", async (c) => {
  const project = c.get("project");
  const identityId = c.req.param("id")!;
  const body = await c.req.json<{ label?: string }>();

  // Verify ownership
  const [identity] = await db
    .select()
    .from(identities)
    .where(
      and(
        eq(identities.id, identityId),
        eq(identities.projectId, project.id),
      ),
    );

  if (!identity) {
    return c.json({ error: "Identity not found or not owned by this project" }, 404);
  }

  const { publicKey, privateKey } = generateKeypair();
  const label = body.label ?? `rotation-${new Date().toISOString().slice(0, 7)}`;

  const [key] = await db.insert(identityKeys).values({
    identityId,
    publicKey,
    label,
    active: true,
  }).returning();

  return c.json({
    kid: key!.id,
    public_key: publicKey,
    private_key: privateKey, // returned ONCE
    label: key!.label,
    created_at: key!.createdAt,
  }, 201);
});

/** DELETE /v1/identities/:id/keys/:kid — Revoke a specific key. */
app.delete("/:kid", async (c) => {
  const project = c.get("project");
  const identityId = c.req.param("id")!;
  const kid = c.req.param("kid")!;

  // Verify ownership
  const [identity] = await db
    .select()
    .from(identities)
    .where(
      and(
        eq(identities.id, identityId),
        eq(identities.projectId, project.id),
      ),
    );

  if (!identity) {
    return c.json({ error: "Identity not found or not owned by this project" }, 404);
  }

  const [key] = await db
    .select()
    .from(identityKeys)
    .where(
      and(
        eq(identityKeys.id, kid),
        eq(identityKeys.identityId, identityId),
        isNull(identityKeys.revokedAt),
      ),
    );

  if (!key) {
    return c.json({ error: "Key not found or already revoked" }, 404);
  }

  await db
    .update(identityKeys)
    .set({ active: false, revokedAt: new Date() })
    .where(eq(identityKeys.id, kid));

  return c.json({ message: "Key revoked", kid });
});

export default app;
