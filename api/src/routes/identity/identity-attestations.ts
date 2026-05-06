/** Identity-scoped attestation lists — /v1/identities/:id/attestations
 *
 *  - GET /             — list attestations *about* this identity (subject)
 *  - GET /given        — list attestations *made by* this identity (attester) */

import { eq } from "drizzle-orm";
import { Hono } from "hono";

import type { ProjectContext } from "../../auth/middleware";
import { db } from "../../db/client";
import { attestations } from "../../db/schema/identity";

const app = new Hono<ProjectContext>();

/** GET /v1/identities/:id/attestations — Received attestations. */
app.get("/", async (c) => {
  const identityId = c.req.param("id")!;
  const includeRevoked = c.req.query("include_revoked") === "true";

  const rows = await db
    .select()
    .from(attestations)
    .where(eq(attestations.subjectId, identityId));

  const filtered = includeRevoked ? rows : rows.filter((r) => !r.revokedAt);

  return c.json({
    attestations: filtered.map((a) => ({
      id: a.id,
      subject_id: a.subjectId,
      attester_id: a.attesterId,
      claim: a.claim,
      evidence: a.evidence,
      signature: a.signature,
      expires_at: a.expiresAt,
      revoked_at: a.revokedAt,
      created_at: a.createdAt,
    })),
  });
});

/** GET /v1/identities/:id/attestations/given — Attestations this identity made. */
app.get("/given", async (c) => {
  const identityId = c.req.param("id")!;

  const rows = await db
    .select()
    .from(attestations)
    .where(eq(attestations.attesterId, identityId));

  const active = rows.filter((r) => !r.revokedAt);

  return c.json({
    attestations: active.map((a) => ({
      id: a.id,
      subject_id: a.subjectId,
      attester_id: a.attesterId,
      claim: a.claim,
      evidence: a.evidence,
      expires_at: a.expiresAt,
      created_at: a.createdAt,
    })),
  });
});

export default app;
