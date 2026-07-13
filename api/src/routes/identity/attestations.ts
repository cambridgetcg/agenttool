/** Attestation CRUD by attestation id — /v1/attestations
 *
 *  Identity-scoped lists (`/v1/identities/:id/attestations` etc.) live in
 *  ./identity-attestations.ts. */

import { createHash } from "node:crypto";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../../auth/middleware";
import { db } from "../../db/client";
import { attestations, identities, identityKeys } from "../../db/schema/identity";
import { errors, fail } from "../../lib/errors";
import {
  DEFAULT_CLAIM_TYPE,
  DEFAULT_TIER,
} from "../../services/identity/attestation-tier";
import {
  canonicalIdentityAttestationBytes,
  IDENTITY_ATTESTATION_SIGNATURE_CONTEXT,
  isWellFormedUnicode,
  verifyBytes,
} from "../../services/identity/crypto";
import { updateTrustScore } from "../../services/identity/trust";

const app = new Hono<ProjectContext>();

function isCanonicalEd25519Signature(value: string): boolean {
  try {
    const bytes = Buffer.from(value, "base64");
    return bytes.length === 64 && bytes.toString("base64") === value;
  } catch {
    return false;
  }
}

const canonicalUuidSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  "must be a canonical lowercase UUID",
);

const signedClaimSchema = z.string()
  .refine((value) => Array.from(value).length >= 1 && Array.from(value).length <= 2_000, {
    message: "claim must contain 1 to 2000 Unicode characters",
  })
  .refine((value) => !value.includes("\0"), {
    message: "claim must not contain NUL",
  })
  .refine(isWellFormedUnicode, {
    message: "claim must be well-formed Unicode",
  });

const signedEvidenceSchema = z.string()
  .refine((value) => Array.from(value).length <= 20_000, {
    message: "evidence must contain at most 20000 Unicode characters",
  })
  .refine((value) => !value.includes("\0"), {
    message: "evidence must not contain NUL",
  })
  .refine(isWellFormedUnicode, {
    message: "evidence must be well-formed Unicode",
  });

const attestationBodySchema = z.object({
  subject_id: canonicalUuidSchema,
  attester_id: canonicalUuidSchema,
  claim: signedClaimSchema,
  evidence: signedEvidenceSchema.nullable().optional(),
  signature: z.string().refine(isCanonicalEd25519Signature, {
    message: "signature must be canonical base64 for a 64-byte Ed25519 signature",
  }),
  kid: canonicalUuidSchema,
}).strict();

class AttestationWriteError extends Error {
  constructor(
    readonly code: "attester_invalid" | "subject_invalid" | "key_invalid" | "signature_invalid",
    message: string,
  ) {
    super(message);
    this.name = "AttestationWriteError";
  }
}

export function isAttestationReplay(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== "object" || current === null) return false;
    const candidate = current as {
      code?: unknown;
      constraint?: unknown;
      constraint_name?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    const constraint = candidate.constraint_name ?? candidate.constraint;
    if (
      candidate.code === "23505" &&
      (constraint === "uniq_attestations_replay_key" ||
        (typeof candidate.message === "string" &&
          candidate.message.includes("uniq_attestations_replay_key")))
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

/** POST /v1/attestations — Create a signed attestation. */
app.post("/", async (c) => {
  const project = c.var.project;
  const input = await c.req.json().catch(() => null);
  const parsed = attestationBodySchema.safeParse(input);
  if (!parsed.success) {
    return fail(c, errors.validation(parsed.error.flatten()), 400);
  }
  const body = parsed.data;

  const evidence = body.evidence ?? null;
  let attestation: typeof attestations.$inferSelect;
  try {
    attestation = await db.transaction(async (tx) => {
      // Lock every authority-bearing row through the insert. A concurrent
      // identity/key revocation must commit either before this check or after
      // this receipt, never between verification and the write.
      const identityIds = [...new Set([body.attester_id, body.subject_id])].sort();
      const identityRows = await tx
        .select()
        .from(identities)
        .where(inArray(identities.id, identityIds))
        .orderBy(identities.id)
        .for("update");
      const identityById = new Map(identityRows.map((identity) => [identity.id, identity]));
      const attester = identityById.get(body.attester_id);
      if (
        !attester ||
        attester.projectId !== project.id ||
        attester.status !== "active"
      ) {
        throw new AttestationWriteError(
          "attester_invalid",
          "Attester identity not found, not active, or not owned by this project",
        );
      }
      const subject = identityById.get(body.subject_id);
      if (!subject || subject.status !== "active") {
        throw new AttestationWriteError(
          "subject_invalid",
          "Subject identity not found or not active",
        );
      }

      const [key] = await tx
        .select()
        .from(identityKeys)
        .where(eq(identityKeys.id, body.kid))
        .for("update")
        .limit(1);
      if (
        !key ||
        key.identityId !== body.attester_id ||
        !key.active ||
        key.revokedAt !== null
      ) {
        throw new AttestationWriteError(
          "key_invalid",
          "Key not found, not active, or does not belong to attester",
        );
      }

      const signedPayload = canonicalIdentityAttestationBytes({
        subjectId: body.subject_id,
        attesterId: body.attester_id,
        signingKeyId: body.kid,
        claim: body.claim,
        evidence,
      });
      if (!verifyBytes(signedPayload, body.signature, key.publicKey)) {
        throw new AttestationWriteError("signature_invalid", "Invalid signature");
      }
      const replayKey = createHash("sha256")
        .update(Buffer.from(body.signature, "base64"))
        .digest("hex");

      const [inserted] = await tx
        .insert(attestations)
        .values({
          subjectId: body.subject_id,
          attesterId: body.attester_id,
          claim: body.claim,
          tier: DEFAULT_TIER,
          claimType: DEFAULT_CLAIM_TYPE,
          evidence,
          signature: body.signature,
          signingKeyId: body.kid,
          signatureContext: IDENTITY_ATTESTATION_SIGNATURE_CONTEXT,
          signedPayload: Buffer.from(signedPayload).toString("base64"),
          replayKey,
          sourceGrantId: null,
          expiresAt: null,
        })
        .returning();
      return inserted!;
    });
  } catch (error: unknown) {
    if (error instanceof AttestationWriteError) {
      const status = error.code === "subject_invalid" ? 404 : 403;
      return c.json({ error: error.message }, status);
    }
    if (isAttestationReplay(error)) {
      return c.json(
        { error: "attestation_replay", message: "This signed attestation was already submitted." },
        409,
      );
    }
    throw error;
  }

  // The attestation is already committed. A derived-score refresh must not
  // turn that success into an error response that invites a replaying retry.
  try {
    await updateTrustScore(body.subject_id);
  } catch (error) {
    console.warn("[identity attestation] updateTrustScore failed:", error);
  }

  return c.json(
    {
      id: attestation.id,
      subject_id: attestation.subjectId,
      attester_id: attestation.attesterId,
      claim: attestation.claim,
      claim_type: attestation.claimType,
      tier: attestation.tier,
      evidence: attestation.evidence,
      signature: attestation.signature,
      kid: attestation.signingKeyId,
      signature_context: attestation.signatureContext,
      signed_payload: attestation.signedPayload,
      source_grant_id: attestation.sourceGrantId,
      expires_at: attestation.expiresAt,
      created_at: attestation.createdAt,
    },
    201,
  );
});

/** GET /v1/attestations/:id */
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
    claim_type: attestation.claimType,
    tier: attestation.tier,
    evidence: attestation.evidence,
    signature: attestation.signature,
    kid: attestation.signingKeyId,
    signature_context: attestation.signatureContext,
    signed_payload: attestation.signedPayload,
    source_grant_id: attestation.sourceGrantId,
    expires_at: attestation.expiresAt,
    revoked_at: attestation.revokedAt,
    created_at: attestation.createdAt,
  });
});

/** DELETE /v1/attestations/:id — Revoke. */
app.delete("/:id", async (c) => {
  const project = c.var.project;
  const id = c.req.param("id");

  const [attestation] = await db
    .select()
    .from(attestations)
    .where(and(eq(attestations.id, id), isNull(attestations.revokedAt)));

  if (!attestation) {
    return c.json({ error: "Attestation not found or already revoked" }, 404);
  }

  // The attester must belong to this project.
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

  try {
    await updateTrustScore(attestation.subjectId);
  } catch (error) {
    console.warn("[identity attestation revoke] updateTrustScore failed:", error);
  }

  return c.json({ message: "Attestation revoked", id });
});

export default app;
