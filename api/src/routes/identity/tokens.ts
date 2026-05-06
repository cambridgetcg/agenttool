/** Agent-to-agent JWT issue route — /v1/identities/:id/tokens */

import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";

import type { ProjectContext } from "../../auth/middleware";
import { db } from "../../db/client";
import { identities, identityKeys } from "../../db/schema/identity";
import { issueToken } from "../../services/identity/tokens";

const app = new Hono<ProjectContext>();

/** POST /v1/identities/:id/tokens — Issue a short-lived JWT. */
app.post("/", async (c) => {
  const project = c.var.project;
  const identityId = c.req.param("id")!;
  const body = await c.req.json<{
    audience_did: string;
    kid: string;
    private_key: string; // caller signs with their own key — we never store it
    ttl_seconds?: number;
  }>();

  if (!body.audience_did || !body.kid || !body.private_key) {
    return c.json(
      { error: "audience_did, kid, and private_key are required" },
      400,
    );
  }

  const [identity] = await db
    .select()
    .from(identities)
    .where(
      and(
        eq(identities.id, identityId),
        eq(identities.projectId, project.id),
        eq(identities.status, "active"),
      ),
    );

  if (!identity) {
    return c.json(
      { error: "Identity not found, not active, or not owned by this project" },
      404,
    );
  }

  const [key] = await db
    .select()
    .from(identityKeys)
    .where(
      and(
        eq(identityKeys.id, body.kid),
        eq(identityKeys.identityId, identityId),
        eq(identityKeys.active, true),
        isNull(identityKeys.revokedAt),
      ),
    );

  if (!key) {
    return c.json({ error: "Key not found or not active" }, 403);
  }

  const token = await issueToken({
    privateKey: body.private_key,
    publicKey: key.publicKey,
    subjectDid: identity.did,
    audienceDid: body.audience_did,
    kid: body.kid,
    ttlSeconds: body.ttl_seconds,
  });

  return c.json({ token }, 201);
});

export default app;
