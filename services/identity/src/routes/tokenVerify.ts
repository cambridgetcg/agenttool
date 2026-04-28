/** Token verification route (standalone, not identity-scoped). */

import { Hono } from "hono";
import { eq, and, isNull } from "drizzle-orm";

import type { ProjectContext } from "../auth/middleware.ts";
import { db } from "../db/client.ts";
import { identities, identityKeys } from "../db/schema.ts";
import { verifyToken } from "../services/tokens.ts";

const app = new Hono<ProjectContext>();

/** POST /v1/tokens/verify — Verify a JWT issued by another agent. */
app.post("/", async (c) => {
  const body = await c.req.json<{
    token: string;
    kid?: string; // optional: specific key to verify against
  }>();

  if (!body.token) {
    return c.json({ error: "token is required" }, 400);
  }

  // Decode the token header to get kid
  const parts = body.token.split(".");
  if (parts.length !== 3) {
    return c.json({ error: "Invalid JWT format" }, 400);
  }

  const header = JSON.parse(Buffer.from(parts[0]!, "base64url").toString());
  const kid = body.kid ?? header.kid;

  if (!kid) {
    return c.json({ error: "Cannot determine key ID (kid) from token or request" }, 400);
  }

  // Look up the key
  const [key] = await db
    .select()
    .from(identityKeys)
    .where(
      and(
        eq(identityKeys.id, kid),
        eq(identityKeys.active, true),
        isNull(identityKeys.revokedAt),
      ),
    );

  if (!key) {
    return c.json({ error: "Signing key not found or revoked" }, 403);
  }

  try {
    const payload = await verifyToken(body.token, key.publicKey);

    return c.json({
      valid: true,
      payload: {
        sub: payload.sub,
        aud: payload.aud,
        iss: payload.iss,
        exp: payload.exp,
        iat: payload.iat,
      },
      key: {
        kid: key.id,
        identity_id: key.identityId,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Token verification failed";
    return c.json({ valid: false, error: message }, 401);
  }
});

export default app;
