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

/** POST /v1/identities/:id/keys/import — Register an externally-generated
 *  ed25519 pubkey as one of this identity's keys. The platform never sees
 *  the private key (held client-side; for the bridged-runtime path, in the
 *  bridge sidecar's keychain). The returned `kid` is what `bridge.key_id`
 *  references when provisioning a runtime; signed thoughts coming back via
 *  the bridge will verify against this row. */
app.post("/import", async (c) => {
  const project = c.var.project;
  const identityId = c.req.param("id")!;
  const body = await c.req.json<{ public_key?: unknown; label?: unknown }>();

  if (typeof body.public_key !== "string" || body.public_key.length === 0) {
    return c.json({ error: "public_key required (base64 ed25519 32-byte pubkey)" }, 400);
  }
  // Sanity-check the length: base64 of 32 bytes is 44 chars (with `=` pad).
  let decodedLen: number;
  try {
    decodedLen = Buffer.from(body.public_key, "base64").length;
  } catch {
    return c.json({ error: "public_key must be valid base64" }, 400);
  }
  if (decodedLen !== 32) {
    return c.json(
      { error: `public_key must decode to 32 bytes; got ${decodedLen}` },
      400,
    );
  }

  const [identity] = await db
    .select()
    .from(identities)
    .where(and(eq(identities.id, identityId), eq(identities.projectId, project.id)));
  if (!identity) {
    return c.json({ error: "Identity not found or not owned by this project" }, 404);
  }

  const label =
    typeof body.label === "string" && body.label.length > 0 ? body.label : "imported";

  const [key] = await db
    .insert(identityKeys)
    .values({
      identityId,
      publicKey: body.public_key,
      label,
      active: true,
    })
    .returning();

  return c.json(
    {
      kid: key!.id,
      public_key: key!.publicKey,
      label: key!.label,
      active: key!.active,
      created_at: key!.createdAt,
      note:
        "Externally-held private key — agenttool never sees it. Use kid as bridge.key_id when provisioning a bridged runtime.",
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
