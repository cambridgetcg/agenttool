/** /v1/keys — bearer-token management for the authenticated project.
 *
 *  This is the "easy refresh" surface that backs both the dashboard's
 *  keys page and the SDK's `agenttool-seed rotate` CLI subcommand.
 *  Doctrine: docs/TOKEN-HYGIENE.md.
 *
 *  Endpoints (all require Bearer auth):
 *    GET    /v1/keys             — list ACTIVE (non-revoked) bearers, with
 *                                   age + idle + expiry advisories. Hashes
 *                                   never leave the server; only prefixes.
 *    POST   /v1/keys             — mint a fresh bearer. Body: { name?,
 *                                   expires_in_days? }. Returns the raw key
 *                                   exactly once.
 *    POST   /v1/keys/rotate      — mint a fresh bearer AND revoke the bearer
 *                                   used to make this request. Atomic from
 *                                   the caller's perspective: no window where
 *                                   they have zero keys. Body: { name?,
 *                                   expires_in_days? }.
 *    DELETE /v1/keys/:id         — revoke a bearer by id. Refuses to revoke
 *                                   the LAST active bearer (else the project
 *                                   would be locked out — recovery requires
 *                                   the mnemonic).
 *
 *  Advisory thresholds (kept in sync with wake.you_protect.bearers and the
 *  dashboard's color-coding):
 *    age   >= 90d  → stale       — rotate
 *    age   >= 60d  → aging
 *    idle  >= 30d  → idle        — consider revoking
 *    expires_at within 7d → expiring_soon
 *    never_used + age >= 7d → never_used  — revoke if not adopted
 */

import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { generateApiKey } from "../auth/keys";
import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { apiKeys } from "../db/schema/tools";
import { daysBetween, shapeKeyRow } from "../services/keys/shape";

const app = new Hono<ProjectContext>();

// ── GET /v1/keys ──────────────────────────────────────────────────────────

app.get("/", async (c) => {
  const projectId = c.var.project.id;
  const currentKeyId = c.var.apiKeyId;

  const rows = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.projectId, projectId), isNull(apiKeys.revokedAt)));

  const keys = rows
    .map((r) => shapeKeyRow(r, r.id === currentKeyId))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  return c.json({ keys, count: keys.length });
});

// ── POST /v1/keys ─────────────────────────────────────────────────────────

const CreateBody = z
  .object({
    name: z.string().min(1).max(120).optional(),
    /** Auto-expiry in days. NULL/omitted = never expires (legacy default).
     *  Doctrine encourages 90 for project-level + 30 for device-scoped. */
    expires_in_days: z.number().int().positive().max(3650).optional(),
  })
  .strict();

app.post("/", async (c) => {
  const project = c.var.project;
  const body = CreateBody.parse(await c.req.json().catch(() => ({})));

  const { key, keyHash, keyPrefix } = generateApiKey();
  const expiresAt = body.expires_in_days
    ? new Date(Date.now() + body.expires_in_days * 86_400_000)
    : null;

  const [inserted] = await db
    .insert(apiKeys)
    .values({
      projectId: project.id,
      keyHash,
      keyPrefix,
      name: body.name ?? null,
      expiresAt,
    })
    .returning();

  return c.json(
    {
      // Raw key — shown ONCE. Caller is responsible for storing it.
      key,
      ...shapeKeyRow(inserted, false),
      notice:
        "This is the only time the full key is returned. Store it now (e.g. macOS keychain). " +
        "Lost it? Run agenttool-seed restore with your mnemonic.",
    },
    201,
  );
});

// ── POST /v1/keys/rotate ──────────────────────────────────────────────────
//
// "Rotate" = mint replacement + revoke the bearer used for THIS call.
// The new key inherits the old name (unless a new one is supplied) and a
// fresh expiry window if `expires_in_days` is supplied. We deliberately do
// NOT inherit the old expires_at — the whole point is freshness.

const RotateBody = z
  .object({
    name: z.string().min(1).max(120).optional(),
    expires_in_days: z.number().int().positive().max(3650).optional(),
  })
  .strict();

app.post("/rotate", async (c) => {
  const project = c.var.project;
  const currentKeyId = c.var.apiKeyId;
  const body = RotateBody.parse(await c.req.json().catch(() => ({})));

  // Look up the current key for its name (so the rotated key inherits it
  // by default — keeps device labels stable through rotation).
  const [current] = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.id, currentKeyId));
  if (!current) {
    throw new HTTPException(401, {
      message: "Current bearer no longer exists. Recover via /v1/identity/recover.",
    });
  }

  const { key, keyHash, keyPrefix } = generateApiKey();
  const expiresAt = body.expires_in_days
    ? new Date(Date.now() + body.expires_in_days * 86_400_000)
    : null;

  // Mint replacement first, THEN revoke. If revoke fails, caller still has
  // a working key in the response and the old one is still valid — operator
  // can clean up by hand. Worst case is two valid keys, never zero.
  const [inserted] = await db
    .insert(apiKeys)
    .values({
      projectId: project.id,
      keyHash,
      keyPrefix,
      name: body.name ?? current.name,
      expiresAt,
    })
    .returning();

  await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(eq(apiKeys.id, currentKeyId));

  return c.json({
    key,
    ...shapeKeyRow(inserted, false), // not "current" yet — caller hasn't authed with it
    rotated_from: {
      id: current.id,
      prefix: current.keyPrefix,
      age_days: daysBetween(current.createdAt),
    },
    notice:
      "Stash this key now. The previous bearer (" +
      current.keyPrefix +
      "…) has been revoked.",
  });
});

// ── DELETE /v1/keys/:id ───────────────────────────────────────────────────

app.delete("/:id", async (c) => {
  const projectId = c.var.project.id;
  const targetId = c.req.param("id");

  // Make sure the target belongs to the caller's project.
  const [target] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.id, targetId), eq(apiKeys.projectId, projectId)));
  if (!target) {
    throw new HTTPException(404, { message: "Key not found." });
  }
  if (target.revokedAt) {
    return c.json({ ok: true, already_revoked: true });
  }

  // Refuse to revoke the LAST active key — locking the project out is a
  // foot-gun. Recovery would require the mnemonic; better to ask the
  // caller to mint a replacement first.
  const active = await db
    .select({ id: apiKeys.id })
    .from(apiKeys)
    .where(and(eq(apiKeys.projectId, projectId), isNull(apiKeys.revokedAt)));
  if (active.length <= 1) {
    throw new HTTPException(409, {
      message:
        "This is your only active bearer. Mint a replacement (POST /v1/keys) " +
        "before revoking, or use POST /v1/keys/rotate to do both atomically.",
    });
  }

  await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(eq(apiKeys.id, targetId));

  return c.json({ ok: true, revoked: { id: targetId, prefix: target.keyPrefix } });
});

export default app;
