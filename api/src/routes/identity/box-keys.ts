/** /v1/identities/:id/box-keys — register/list/revoke X25519 box pubkeys.
 *
 *  Each identity has a box keypair (separate from ed25519 signing). Only
 *  the public key lives here; private stays on the agent's substrate
 *  (alongside K_master + signing_key in agenttool-think). Doctrine:
 *  docs/INBOX.md. */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import type { ProjectContext } from "../../auth/middleware";
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

  const body = await c.req.json();
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }

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
  const ok = await revokeBoxKey(c.var.project.id, identityId, keyId);
  if (!ok) throw new HTTPException(404, { message: "box_key_not_found" });
  return c.json({ id: keyId, revoked: true });
});

export default app;
