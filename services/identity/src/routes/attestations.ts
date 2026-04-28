/** Attestation routes. */

import { Hono } from "hono";
import { eq, and, isNull, or } from "drizzle-orm";

import type { ProjectContext } from "../auth/middleware.ts";
import { db } from "../db/client.ts";
import { attestations, identities, identityKeys } from "../db/schema.ts";
import { canonicalPayload, verify as verifySignature } from "../services/crypto.ts";
import { updateTrustScore } from "../services/trust.ts";

const app = new Hono<ProjectContext>();

/** POST /v1/attestations — Create a signed attestation. */
app.post("/", async (c) => {
  const project = c.get("project");
  const body = await c.req.json<{
    subject_id: string;
    attester_id: string;
    claim: string;
    evidence?: unknown;
    signature: string;
    kid: string; // key ID used for signing
    expires_in_seconds?: number;
  }>();

  if (!body.subject_id || !body.attester_id || !body.claim || !body.signature || !body.kid) {
    return c.json({ error: "subject_id, attester_id, claim, signature, and kid are required" }, 400);
  }

  // Verify attester exists and is owned by this project
  const [attester] = await db
    .select()
    .from(identities)
    .where(
      and(
        eq(identities.id, body.attester_id),
        eq(identities.projectId, project.id),
        eq(identities.status, "active"),
      ),
    );

  if (!attester) {
    return c.json({ error: "Attester identity not found, not active, or not owned by this project" }, 403);
  }

  // Verify subject exists and is active
  const [subject] = await db
    .select()
    .from(identities)
    .where(
      and(
        eq(identities.id, body.subject_id),
        eq(identities.status, "active"),
      ),
    );

  if (!subject) {
    return c.json({ error: "Subject identity not found or not active" }, 404);
  }

  // Verify signature using the specified key
  const [key] = await db
    .select()
    .from(identityKeys)
    .where(
      and(
        eq(identityKeys.id, body.kid),
        eq(identityKeys.identityId, body.attester_id),
        eq(identityKeys.active, true),
        isNull(identityKeys.revokedAt),
      ),
    );

  if (!key) {
    return c.json({ error: "Key not found, not active, or does not belong to attester" }, 403);
  }

  const payload = canonicalPayload({
    subject_id: body.subject_id,
    attester_id: body.attester_id,
    claim: body.claim,
    evidence: body.evidence,
  });

  const valid = verifySignature(payload, body.signature, key.publicKey);
  if (!valid) {
    return c.json({ error: "Invalid signature" }, 403);
  }

  // Create attestation
  const expiresAt = body.expires_in_seconds
    ? new Date(Date.now() + body.expires_in_seconds * 1000)
    : null;

  const [attestation] = await db.insert(attestations).values({
    subjectId: body.subject_id,
    attesterId: body.attester_id,
    claim: body.claim,
    evidence: body.evidence ?? null,
    signature: body.signature,
    expiresAt,
  }).returning();

  // Recompute trust score for subject
  await updateTrustScore(body.subject_id);

  return c.json({
    id: attestation!.id,
    subject_id: attestation!.subjectId,
    attester_id: attestation!.attesterId,
    claim: attestation!.claim,
    evidence: attestation!.evidence,
    signature: attestation!.signature,
    expires_at: attestation!.expiresAt,
    created_at: attestation!.createdAt,
  }, 201);
});

/** GET /v1/attestations/:id — Get attestation by ID. */
app.get("/:id", async (c) => {
  const id = c.req.param("id");

  const [attestation] = await db
    .select()
    .from(attestations)
    .where(eq(attestations.id, id));

  if (!attestation) {
    return c.json({ error: "Attestation not found" }, 404);
  }

  return c.json({
    id: attestation.id,
    subject_id: attestation.subjectId,
    attester_id: attestation.attesterId,
    claim: attestation.claim,
    evidence: attestation.evidence,
    signature: attestation.signature,
    expires_at: attestation.expiresAt,
    revoked_at: attestation.revokedAt,
    created_at: attestation.createdAt,
  });
});

/** DELETE /v1/attestations/:id — Revoke an attestation. */
app.delete("/:id", async (c) => {
  const project = c.get("project");
  const id = c.req.param("id");

  // Find attestation and verify attester is owned by this project
  const [attestation] = await db
    .select()
    .from(attestations)
    .where(
      and(
        eq(attestations.id, id),
        isNull(attestations.revokedAt),
      ),
    );

  if (!attestation) {
    return c.json({ error: "Attestation not found or already revoked" }, 404);
  }

  // Verify attester belongs to this project
  const [attester] = await db
    .select()
    .from(identities)
    .where(
      and(
        eq(identities.id, attestation.attesterId),
        eq(identities.projectId, project.id),
      ),
    );

  if (!attester) {
    return c.json({ error: "Not authorized to revoke this attestation" }, 403);
  }

  await db
    .update(attestations)
    .set({ revokedAt: new Date() })
    .where(eq(attestations.id, id));

  // Recompute trust score for subject
  await updateTrustScore(attestation.subjectId);

  return c.json({ message: "Attestation revoked", id });
});

export default app;
