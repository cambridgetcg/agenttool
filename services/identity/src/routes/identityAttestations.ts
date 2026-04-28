/** Identity-scoped attestation list routes. */

import { Hono } from "hono";
import { eq } from "drizzle-orm";

import type { ProjectContext } from "../auth/middleware.ts";
import { db } from "../db/client.ts";
import { attestations } from "../db/schema.ts";

const app = new Hono<ProjectContext>();

/** GET /v1/identities/:id/attestations — List attestations about an identity (received). */
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

/** GET /v1/identities/:id/attestations/given — List attestations made by an identity. */
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
