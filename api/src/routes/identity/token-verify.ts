/** JWT verification — /v1/tokens/verify
 *
 *  Reads the kid from the token header (or the body), looks up the matching
 *  active public key, verifies the JWT against it, and returns the decoded
 *  payload on success. */

import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";

import type { ProjectContext } from "../../auth/middleware";
import { db } from "../../db/client";
import { identityKeys } from "../../db/schema/identity";
import { verifyToken } from "../../services/identity/tokens";

const app = new Hono<ProjectContext>();

app.post("/", async (c) => {
  const body = await c.req.json<{
    token: string;
    kid?: string;
  }>();

  if (!body.token) {
    return c.json({ error: "token is required" }, 400);
  }

  const parts = body.token.split(".");
  if (parts.length !== 3) {
    return c.json({ error: "Invalid JWT format" }, 400);
  }

  let header: { kid?: string };
  try {
    header = JSON.parse(Buffer.from(parts[0]!, "base64url").toString());
  } catch {
    return c.json({ error: "Invalid JWT header" }, 400);
  }

  const kid = body.kid ?? header.kid;
  if (!kid) {
    return c.json(
      { error: "Cannot determine key ID (kid) from token or request" },
      400,
    );
  }

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
