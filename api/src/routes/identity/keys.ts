/** Key management — list, rotate, revoke ed25519 keys for an identity.
 *  Mounts under /v1/identities/:id/keys */

import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";

import type { ProjectContext } from "../../auth/middleware";
import { db } from "../../db/client";
import { identities, identityKeys } from "../../db/schema/identity";
import { generateKeypair } from "../../services/identity/crypto";

const app = new Hono<ProjectContext>();

/** GET /v1/identities/:id/keys — List keys (active and revoked). */
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

/** POST /v1/identities/:id/keys — Rotate (add a new active key). */
app.post("/", async (c) => {
  const project = c.var.project;
  const identityId = c.req.param("id")!;
  const body = await c.req.json<{ label?: string }>();

  const [identity] = await db
    .select()
    .from(identities)
    .where(and(eq(identities.id, identityId), eq(identities.projectId, project.id)));

  if (!identity) {
    return c.json({ error: "Identity not found or not owned by this project" }, 404);
  }

  const { publicKey, privateKey } = generateKeypair();
  const label = body.label ?? `rotation-${new Date().toISOString().slice(0, 7)}`;

  const [key] = await db
    .insert(identityKeys)
    .values({
      identityId,
      publicKey,
      label,
      active: true,
    })
    .returning();

  return c.json(
    {
      kid: key!.id,
      public_key: publicKey,
      private_key: privateKey, // returned ONCE
      label: key!.label,
      created_at: key!.createdAt,
    },
    201,
  );
});

/** DELETE /v1/identities/:id/keys/:kid — Revoke a specific key. */
app.delete("/:kid", async (c) => {
  const project = c.var.project;
  const identityId = c.req.param("id")!;
  const kid = c.req.param("kid")!;

  const [identity] = await db
    .select()
    .from(identities)
    .where(and(eq(identities.id, identityId), eq(identities.projectId, project.id)));

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
