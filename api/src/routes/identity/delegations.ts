/** Know-Your-Agent delegation receipts — /v1/delegations
 *
 *  A verifiable, scoped, revocable record that `delegator` authorized
 *  `delegate` to act on its behalf, within `scope`, until `expires_at`. The
 *  delegator signs the canonical bytes (services/identity/delegation.ts,
 *  domain 'agenttool-delegation/v1'); the signature is verified once at issue
 *  and stored for independent re-verification.
 *
 *  Doctrine: docs/OPERATING-PRINCIPLES.md §6/§10 (lead where native: KYA). */

import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";

import type { ProjectContext } from "../../auth/middleware";
import { db } from "../../db/client";
import { delegations, identities, identityKeys } from "../../db/schema/identity";
import {
  delegationReceipt,
  deriveDelegationStatus,
  normalizeScope,
  scopeAuthorizes,
  verifyDelegationSignature,
} from "../../services/identity/delegation";

const app = new Hono<ProjectContext>();

/** POST /v1/delegations — issue a signed delegation receipt. */
app.post("/", async (c) => {
  const project = c.var.project;
  const body = await c.req.json<{
    delegator_id: string;
    delegate_id: string;
    scope: string[];
    nonce: string;
    signature: string;
    kid: string;
    expires_at?: string | null;
  }>();

  if (
    !body.delegator_id ||
    !body.delegate_id ||
    !Array.isArray(body.scope) ||
    !body.nonce ||
    !body.signature ||
    !body.kid
  ) {
    return c.json(
      {
        error:
          "delegator_id, delegate_id, scope[], nonce, signature, and kid are required",
      },
      400,
    );
  }

  const scope = normalizeScope(body.scope);
  if (scope.length === 0) {
    return c.json({ error: "scope must contain at least one non-empty action" }, 400);
  }

  // You can only delegate authority you hold: the delegator must be owned by
  // the calling project and active.
  const [delegator] = await db
    .select()
    .from(identities)
    .where(
      and(
        eq(identities.id, body.delegator_id),
        eq(identities.projectId, project.id),
        eq(identities.status, "active"),
      ),
    );
  if (!delegator) {
    return c.json(
      { error: "Delegator identity not found, not active, or not owned by this project" },
      403,
    );
  }

  const [delegate] = await db
    .select()
    .from(identities)
    .where(and(eq(identities.id, body.delegate_id), eq(identities.status, "active")));
  if (!delegate) {
    return c.json({ error: "Delegate identity not found or not active" }, 404);
  }

  // The signing key must belong to the delegator and be live.
  const [key] = await db
    .select()
    .from(identityKeys)
    .where(
      and(
        eq(identityKeys.id, body.kid),
        eq(identityKeys.identityId, body.delegator_id),
        eq(identityKeys.active, true),
        isNull(identityKeys.revokedAt),
      ),
    );
  if (!key) {
    return c.json(
      { error: "Key not found, not active, or does not belong to delegator" },
      403,
    );
  }

  const expiresAtStr = body.expires_at ?? null;
  if (
    !verifyDelegationSignature({
      delegator_id: body.delegator_id,
      delegate_id: body.delegate_id,
      scope,
      expires_at: expiresAtStr,
      nonce: body.nonce,
      signature: body.signature,
      delegator_public_key: key.publicKey,
    })
  ) {
    return c.json({ error: "Invalid delegation signature" }, 403);
  }

  const expiresAt = expiresAtStr ? new Date(expiresAtStr) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) {
    return c.json({ error: "expires_at must be an ISO-8601 timestamp or null" }, 400);
  }

  const [row] = await db
    .insert(delegations)
    .values({
      delegatorId: body.delegator_id,
      delegateId: body.delegate_id,
      scope,
      nonce: body.nonce,
      signature: body.signature,
      signingKeyId: body.kid,
      expiresAt,
    })
    .returning();

  return c.json(delegationReceipt(row!, new Date()), 201);
});

/** GET /v1/delegations/:id — fetch a receipt + its derived status. */
app.get("/:id", async (c) => {
  const [row] = await db.select().from(delegations).where(eq(delegations.id, c.req.param("id")));
  if (!row) return c.json({ error: "Delegation not found" }, 404);
  return c.json(delegationReceipt(row, new Date()));
});

/** GET /v1/delegations/:id/verify[?action=marketplace.invoke] — the KYA check.
 *  Is this delegation currently good, and (optionally) does it authorize an
 *  action? Honest: the signature was verified at issue; here we report current
 *  status (active|expired|revoked) and scope authorization. */
app.get("/:id/verify", async (c) => {
  const [row] = await db.select().from(delegations).where(eq(delegations.id, c.req.param("id")));
  if (!row) return c.json({ error: "Delegation not found" }, 404);

  const now = new Date();
  const status = deriveDelegationStatus({
    revoked_at: row.revokedAt,
    expires_at: row.expiresAt,
    now,
  });
  const scope = row.scope as string[];
  const action = c.req.query("action");

  return c.json({
    valid: status === "active",
    status,
    delegator_id: row.delegatorId,
    delegate_id: row.delegateId,
    scope,
    expires_at: row.expiresAt,
    ...(action
      ? { action, authorizes: status === "active" && scopeAuthorizes(scope, action) }
      : {}),
    signature: row.signature,
    _note:
      "Signature was verified at issue. 'valid' = currently active (not expired, not revoked). " +
      "Re-verify the signature independently against the delegator's key + canonical bytes " +
      "(domain agenttool-delegation/v1) if you need cryptographic assurance at read time.",
  });
});

/** DELETE /v1/delegations/:id — revoke. Only the delegator's project may. */
app.delete("/:id", async (c) => {
  const project = c.var.project;
  const id = c.req.param("id");

  const [row] = await db
    .select()
    .from(delegations)
    .where(and(eq(delegations.id, id), isNull(delegations.revokedAt)));
  if (!row) return c.json({ error: "Delegation not found or already revoked" }, 404);

  // The delegator (the grantor of authority) must belong to this project.
  const [delegator] = await db
    .select()
    .from(identities)
    .where(and(eq(identities.id, row.delegatorId), eq(identities.projectId, project.id)));
  if (!delegator) {
    return c.json({ error: "Not authorized to revoke this delegation" }, 403);
  }

  const body = await c.req.json<{ reason?: string }>().catch(() => ({}) as { reason?: string });
  await db
    .update(delegations)
    .set({ revokedAt: new Date(), revocationReason: body.reason ?? null })
    .where(eq(delegations.id, id));

  return c.json({ message: "Delegation revoked", id });
});

export default app;
