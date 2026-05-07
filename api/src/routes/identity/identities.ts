/** Identity CRUD — POST · GET · PATCH · DELETE on /v1/identities */

import { randomUUID } from "node:crypto";

import { and, eq, or } from "drizzle-orm";
import { Hono } from "hono";

import type { ProjectContext } from "../../auth/middleware";
import { db } from "../../db/client";
import { identities, identityKeys } from "../../db/schema/identity";
import { generateKeypair } from "../../services/identity/crypto";

const app = new Hono<ProjectContext>();

/** Lookup helper — accept either a UUID or a `did:at:<uuid>` string. */
function idOrDidPredicate(idParam: string) {
  const isUuid = !idParam.startsWith("did:");
  // Use a sentinel UUID for the wrong branch — eq returns false on mismatch.
  return or(
    eq(identities.id, isUuid ? idParam : "00000000-0000-0000-0000-000000000000"),
    eq(identities.did, idParam),
  );
}

/** POST /v1/identities — Register a new agent identity. */
app.post("/", async (c) => {
  const project = c.var.project;
  const body = await c.req.json<{
    display_name: string;
    capabilities?: string[];
    metadata?: Record<string, unknown>;
  }>();

  if (!body.display_name) {
    return c.json({ error: "display_name is required" }, 400);
  }

  const id = randomUUID();
  const did = `did:at:${id}`;
  const { publicKey, privateKey } = generateKeypair();
  const keyId = randomUUID();

  const [identity] = await db
    .insert(identities)
    .values({
      id,
      did,
      projectId: project.id,
      displayName: body.display_name,
      capabilities: body.capabilities ?? [],
      metadata: body.metadata ?? {},
      status: "active",
      trustScore: 0,
    })
    .returning();

  await db.insert(identityKeys).values({
    id: keyId,
    identityId: id,
    publicKey,
    label: "primary",
    active: true,
  });

  return c.json(
    {
      identity: {
        id: identity!.id,
        did: identity!.did,
        display_name: identity!.displayName,
        capabilities: identity!.capabilities,
        metadata: identity!.metadata,
        status: identity!.status,
        trust_score: identity!.trustScore,
        created_at: identity!.createdAt,
      },
      key: {
        kid: keyId,
        public_key: publicKey,
        private_key: privateKey, // returned ONCE, never stored server-side
      },
    },
    201,
  );
});

/** GET /v1/identities/:id — Fetch by UUID or DID. */
app.get("/:id", async (c) => {
  const idParam = c.req.param("id");

  const [identity] = await db
    .select()
    .from(identities)
    .where(idOrDidPredicate(idParam));

  if (!identity) {
    return c.json({ error: "Identity not found" }, 404);
  }

  return c.json({
    id: identity.id,
    did: identity.did,
    display_name: identity.displayName,
    capabilities: identity.capabilities,
    metadata: identity.metadata,
    status: identity.status,
    trust_score: identity.trustScore,
    created_at: identity.createdAt,
    updated_at: identity.updatedAt,
  });
});

/** PATCH /v1/identities/:id — Update display_name, capabilities, metadata,
 *  expression_visibility (private/public toggle for the declared expression). */
app.patch("/:id", async (c) => {
  const project = c.var.project;
  const idParam = c.req.param("id");
  const body = await c.req.json<{
    display_name?: string;
    capabilities?: string[];
    metadata?: Record<string, unknown>;
    expression_visibility?: "private" | "public";
  }>();

  const [identity] = await db
    .select()
    .from(identities)
    .where(and(idOrDidPredicate(idParam), eq(identities.projectId, project.id)));

  if (!identity) {
    return c.json({ error: "Identity not found or not owned by this project" }, 404);
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.display_name !== undefined) updates.displayName = body.display_name;
  if (body.capabilities !== undefined) updates.capabilities = body.capabilities;
  if (body.metadata !== undefined) updates.metadata = body.metadata;
  if (body.expression_visibility !== undefined) {
    if (body.expression_visibility !== "private" && body.expression_visibility !== "public") {
      return c.json({ error: "expression_visibility must be 'private' or 'public'" }, 400);
    }
    updates.expressionVisibility = body.expression_visibility;
  }

  const [updated] = await db
    .update(identities)
    .set(updates)
    .where(eq(identities.id, identity.id))
    .returning();

  return c.json({
    id: updated!.id,
    did: updated!.did,
    display_name: updated!.displayName,
    capabilities: updated!.capabilities,
    metadata: updated!.metadata,
    status: updated!.status,
    trust_score: updated!.trustScore,
    expression_visibility: updated!.expressionVisibility,
    updated_at: updated!.updatedAt,
  });
});

/** DELETE /v1/identities/:id — Soft revoke. */
app.delete("/:id", async (c) => {
  const project = c.var.project;
  const idParam = c.req.param("id");

  const [identity] = await db
    .select()
    .from(identities)
    .where(and(idOrDidPredicate(idParam), eq(identities.projectId, project.id)));

  if (!identity) {
    return c.json({ error: "Identity not found or not owned by this project" }, 404);
  }

  await db
    .update(identities)
    .set({ status: "revoked", updatedAt: new Date() })
    .where(eq(identities.id, identity.id));

  return c.json({ message: "Identity revoked", id: identity.id });
});

export default app;
