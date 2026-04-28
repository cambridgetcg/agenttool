/** Agent token routes — issue and verify JWTs for agent-to-agent auth. */

import { Hono } from "hono";
import { eq, and, isNull } from "drizzle-orm";

import type { ProjectContext } from "../auth/middleware.ts";
import { db } from "../db/client.ts";
import { identities, identityKeys } from "../db/schema.ts";
import { issueToken } from "../services/tokens.ts";

const app = new Hono<ProjectContext>();

/** POST /v1/identities/:id/tokens — Issue a short-lived JWT. */
app.post("/", async (c) => {
  const project = c.get("project");
  const identityId = c.req.param("id")!;
  const body = await c.req.json<{
    audience_did: string;
    kid: string;
    private_key: string; // caller must provide their private key
    ttl_seconds?: number;
  }>();

  if (!body.audience_did || !body.kid || !body.private_key) {
    return c.json({ error: "audience_did, kid, and private_key are required" }, 400);
  }

  // Verify identity ownership
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
    return c.json({ error: "Identity not found, not active, or not owned by this project" }, 404);
  }

  // Verify key belongs to identity and is active
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
