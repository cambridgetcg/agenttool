/** /v1/identities/:id/box-keys — register/list/revoke X25519 box pubkeys.
 *
 *  Each identity has a box keypair (separate from ed25519 signing). Only
 *  the public key lives here; private stays on the agent's substrate
 *  (alongside K_master + signing_key in agenttool-think). Doctrine:
 *  docs/INBOX.md. */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";

import type { ProjectContext } from "../../auth/middleware";
import { db } from "../../db/client";
import { identities, identityBoxKeys } from "../../db/schema/identity";
import { errors, fail } from "../../lib/errors";
import {
  authorizeIdentityMutation,
  authorityRequestTarget,
  readAuthorityBoundJson,
  readEmptyAuthorityBody,
} from "../../services/identity/authority";
import {
  listBoxKeys,
  registerBoxKey,
  revokeBoxKey,
} from "../../services/inbox/store";

// Mounted at /v1/identities/:id/box-keys.
const app = new Hono<ProjectContext>();

const registerSchema = z.object({
  public_key: z.string().min(1).max(255),
  label: z.string().max(64).optional(),
});

// ── POST /v1/identities/:id/box-keys ──────────────────────────────────
app.post("/", async (c) => {
  const identityId = c.req.param("id");
  if (!identityId) throw new HTTPException(400, { message: "identity_id_required" });

  let bound: Awaited<ReturnType<typeof readAuthorityBoundJson>>;
  try {
    bound = await readAuthorityBoundJson(c.req.raw);
  } catch {
    return fail(
      c,
      errors.refusal({
        error: "body_must_be_json",
        message: "Send one JSON object and sign those exact entity bytes.",
        docs: "https://docs.agenttool.dev/AGENT-HOME.md",
      }),
      400,
    );
  }
  const parsed = registerSchema.safeParse(bound.value);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }

  const [identity] = await db
    .select({ id: identities.id })
    .from(identities)
    .where(
      and(
        eq(identities.id, identityId),
        eq(identities.projectId, c.var.project.id),
      ),
    )
    .limit(1);
  if (!identity) throw new HTTPException(404, { message: "identity_not_found" });

  const authority = await authorizeIdentityMutation({
    identityId,
    method: c.req.method,
    requestTarget: authorityRequestTarget(c.req.url),
    bodyBytes: bound.bodyBytes,
    headers: c.req.raw.headers,
  });
  if (!authority.ok) return c.json(authority.body, authority.status);

  try {
    const result = await registerBoxKey(
      c.var.project.id,
      identityId,
      parsed.data.public_key,
      parsed.data.label,
    );
    return c.json({ ...result, registered: true }, 201);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === "identity_not_found" || msg === "identity_not_owned_by_caller") {
      throw new HTTPException(404, { message: "identity_not_found" });
    }
    if (msg === "public_key_not_base64" || msg === "public_key_not_32_bytes") {
      return c.json({ error: msg }, 400);
    }
    if (msg === "identity_memorial_terminal") {
      return c.json(
        {
          error: msg,
          message: "A memorial identity's box-key registry is immutable.",
        },
        409,
      );
    }
    throw err;
  }
});

// ── GET /v1/identities/:id/box-keys ───────────────────────────────────
app.get("/", async (c) => {
  const identityId = c.req.param("id");
  if (!identityId) throw new HTTPException(400, { message: "identity_id_required" });

  const keys = await listBoxKeys(c.var.project.id, identityId);
  return c.json({ keys, count: keys.length });
});

// ── DELETE /v1/identities/:id/box-keys/:keyId ─────────────────────────
app.delete("/:keyId", async (c) => {
  const identityId = c.req.param("id");
  const keyId = c.req.param("keyId");
  if (!identityId || !keyId) {
    throw new HTTPException(400, { message: "identity_id_and_key_id_required" });
  }
  const [key] = await db
    .select({ id: identityBoxKeys.id })
    .from(identityBoxKeys)
    .innerJoin(identities, eq(identities.id, identityBoxKeys.identityId))
    .where(
      and(
        eq(identityBoxKeys.id, keyId),
        eq(identityBoxKeys.identityId, identityId),
        isNull(identityBoxKeys.revokedAt),
        eq(identities.projectId, c.var.project.id),
      ),
    )
    .limit(1);
  if (!key) throw new HTTPException(404, { message: "box_key_not_found" });

  let bodyBytes: Uint8Array;
  try {
    bodyBytes = await readEmptyAuthorityBody(c.req.raw);
  } catch {
    return fail(
      c,
      errors.refusal({
        error: "delete_body_not_allowed",
        message: "This DELETE operation does not accept an entity body.",
        hint: "Sign and send the exact DELETE path with an empty body.",
        docs: "https://docs.agenttool.dev/AGENT-HOME.md",
      }),
      400,
    );
  }

  const authority = await authorizeIdentityMutation({
    identityId,
    method: c.req.method,
    requestTarget: authorityRequestTarget(c.req.url),
    bodyBytes,
    headers: c.req.raw.headers,
  });
  if (!authority.ok) return c.json(authority.body, authority.status);

  try {
    const ok = await revokeBoxKey(c.var.project.id, identityId, keyId);
    if (!ok) throw new HTTPException(404, { message: "box_key_not_found" });
    return c.json({ id: keyId, revoked: true });
  } catch (err) {
    if ((err as Error).message === "identity_memorial_terminal") {
      return c.json(
        {
          error: "identity_memorial_terminal",
          message: "A memorial identity's box-key registry is immutable.",
        },
        409,
      );
    }
    throw err;
  }
});

export default app;
