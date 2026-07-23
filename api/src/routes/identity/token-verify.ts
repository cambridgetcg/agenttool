/** JWT verification — /v1/tokens/verify
 *
 *  Reads the kid from the protected token header, looks up the matching
 *  active public key, verifies the JWT against it, and returns the decoded
 *  payload on success. */

import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { decodeProtectedHeader } from "jose";
import { z } from "zod";

import type { ProjectContext } from "../../auth/middleware";
import { db } from "../../db/client";
import { identities, identityKeys } from "../../db/schema/identity";
import { errors, fail } from "../../lib/errors";
import { verifyToken } from "../../services/identity/tokens";

const app = new Hono<ProjectContext>();

const verifyBodySchema = z.object({
  token: z.string().min(1).max(16_384),
  audience_did: z.string().max(512).regex(/^did:[a-z0-9]+:.+$/),
}).strict();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

app.post("/", async (c) => {
  const input = await c.req.json().catch(() => null);
  const parsed = verifyBodySchema.safeParse(input);
  if (!parsed.success) {
    return fail(c, errors.validation(parsed.error.flatten()), 400);
  }
  const body = parsed.data;

  let header: ReturnType<typeof decodeProtectedHeader>;
  try {
    header = decodeProtectedHeader(body.token);
  } catch {
    return c.json({ error: "Invalid JWT header" }, 400);
  }

  if (header.alg !== "EdDSA") {
    return c.json({ error: "JWT protected header alg must be EdDSA" }, 400);
  }
  if (typeof header.kid !== "string" || !UUID_RE.test(header.kid)) {
    return c.json({ error: "JWT protected header kid must be a UUID" }, 400);
  }
  const kid = header.kid;

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

  const [identity] = await db
    .select({ id: identities.id, did: identities.did })
    .from(identities)
    .where(
      and(
        eq(identities.id, key.identityId),
        eq(identities.status, "active"),
      ),
    );

  if (!identity) {
    return c.json({ error: "Signing identity not found or inactive" }, 403);
  }

  const [audienceIdentity] = await db
    .select({ id: identities.id })
    .from(identities)
    .where(
      and(
        eq(identities.did, body.audience_did),
        eq(identities.projectId, c.var.project.id),
        eq(identities.status, "active"),
      ),
    );

  if (!audienceIdentity) {
    return c.json(
      { error: "Audience identity not found, inactive, or not owned by this project" },
      403,
    );
  }

  try {
    const payload = await verifyToken(body.token, key.publicKey, body.audience_did);
    if (payload.sub !== identity.did) {
      return c.json(
        { valid: false, error: "Token subject does not own the signing key" },
        401,
      );
    }
    return c.json({
      valid: true,
      payload: {
        sub: payload.sub,
        aud: payload.aud,
        iss: payload.iss,
        exp: payload.exp,
        iat: payload.iat,
        scope: payload.scope,
      },
      key: {
        kid: key.id,
        identity_id: key.identityId,
      },
    });
  } catch {
    return c.json(
      { valid: false, error: "Token signature or claims did not verify" },
      401,
    );
  }
});

export default app;
