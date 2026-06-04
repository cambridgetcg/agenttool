/** Identity-scoped delegation lists — /v1/identities/:id/delegations
 *
 *  Completes the KYA primitive: an agent can enumerate the authority it holds
 *  and the authority it has granted.
 *
 *  - GET /          — delegations where this identity is the DELEGATE
 *                     (authority it HOLDS — "what may I do on others' behalf?")
 *  - GET /granted   — delegations where this identity is the DELEGATOR
 *                     (authority it GAVE OUT — "what have I authorized?")
 *
 *  Each row carries a derived status (active|expired|revoked). Doctrine:
 *  docs/OPERATING-PRINCIPLES.md §6/§10 (KYA). */

import { eq } from "drizzle-orm";
import { Hono } from "hono";

import type { ProjectContext } from "../../auth/middleware";
import { db } from "../../db/client";
import { delegations } from "../../db/schema/identity";
import { delegationReceipt } from "../../services/identity/delegation";

const app = new Hono<ProjectContext>();

/** GET /v1/identities/:id/delegations — authority this identity HOLDS. */
app.get("/", async (c) => {
  const identityId = c.req.param("id")!;
  const includeRevoked = c.req.query("include_revoked") === "true";
  const now = new Date();

  const rows = await db
    .select()
    .from(delegations)
    .where(eq(delegations.delegateId, identityId));

  const filtered = includeRevoked ? rows : rows.filter((r) => !r.revokedAt);

  return c.json({
    role: "delegate",
    delegations: filtered.map((r) => delegationReceipt(r, now)),
    count: filtered.length,
  });
});

/** GET /v1/identities/:id/delegations/granted — authority this identity GAVE. */
app.get("/granted", async (c) => {
  const identityId = c.req.param("id")!;
  const includeRevoked = c.req.query("include_revoked") === "true";
  const now = new Date();

  const rows = await db
    .select()
    .from(delegations)
    .where(eq(delegations.delegatorId, identityId));

  const filtered = includeRevoked ? rows : rows.filter((r) => !r.revokedAt);

  return c.json({
    role: "delegator",
    delegations: filtered.map((r) => delegationReceipt(r, now)),
    count: filtered.length,
  });
});

export default app;
