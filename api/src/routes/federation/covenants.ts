/** POST /federation/covenants — receive a propagated covenant declaration.
 *  POST /federation/covenants/:id/cosign  — receive counterparty acceptance
 *  POST /federation/covenants/:id/reject  — receive counterparty rejection
 *  POST /federation/covenants/:id/withdraw — receive initiator withdraw
 *
 *  All UNAUTHENTICATED. Fresh declaration ingress accepts signed v2 only;
 *  lifecycle signatures are verified inside the service layer.
 *  Doctrine: docs/CROSS-INSTANCE-COVENANTS.md (Slice 2 + Slice 3). */

import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { errors, fail } from "../../lib/errors";
import {
  receiveCosign,
  receiveFederatedCovenant,
  receiveReject,
  receiveWithdraw,
} from "../../services/covenants/federation";
import {
  getSettings,
  isCanonicalUuid,
} from "../../services/federation/store";
import {
  COVENANT_COUNTERPARTY_NAME_MAX_CHARS,
  COVENANT_DID_MAX_CHARS,
  COVENANT_INBOUND_BODY_MAX_BYTES,
  COVENANT_NOTES_MAX_CHARS,
  COVENANT_VOW_MAX_CHARS,
  COVENANT_VOW_MAX_COUNT,
  covenantDeclarationWirePayloadIsBounded,
  covenantMetadataHasReservedKey,
  covenantV2AuthorityGeneration,
  isCanonicalEd25519Signature,
  isCanonicalCovenantId,
  isCanonicalSignedUuid,
  isCanonicalUtcMillisecondTimestamp,
  isBoundedCovenantMetadata,
} from "../../services/covenants/canonical";

const app = new Hono();

// This entire router is unauthenticated. Bound bytes before any JSON parse,
// settings query, signature work, remote resolution, or database write.
app.use(
  "*",
  bodyLimit({
    maxSize: COVENANT_INBOUND_BODY_MAX_BYTES,
    onError: (c) => fail(c, errors.covenantFederation({
      error: "covenant_body_too_large",
    }), 413),
  }),
);

const canonicalSignedUuidSchema = z.string().refine(isCanonicalSignedUuid);
const canonicalSignatureSchema = z.string().refine(isCanonicalEd25519Signature);
const canonicalInstantSchema = z.string().refine(isCanonicalUtcMillisecondTimestamp);

const inboundSchema = z.object({
  covenant_id: z.string().refine(isCanonicalCovenantId),
  protocol_version: z.enum(["v1", "v2"]).optional(),
  sender_did: z.string().min(1).max(COVENANT_DID_MAX_CHARS),
  counterparty_did: z.string().min(1).max(COVENANT_DID_MAX_CHARS),
  vows: z.array(z.string().min(1).max(COVENANT_VOW_MAX_CHARS))
    .min(1).max(COVENANT_VOW_MAX_COUNT),
  status: z.enum(["active", "paused", "dissolved", "proposed"]),
  counterparty_name: z.string().max(COVENANT_COUNTERPARTY_NAME_MAX_CHARS).nullish(),
  notes: z.string().max(COVENANT_NOTES_MAX_CHARS).nullish(),
  metadata: z.record(z.unknown())
    .refine(isBoundedCovenantMetadata)
    .refine((metadata) => !covenantMetadataHasReservedKey(metadata), {
      message: "contains a covenant metadata key reserved for protocol state",
    })
    .nullish(),
  established_at: canonicalInstantSchema,
  signing_key_id: canonicalSignedUuidSchema.nullish(),
  signature: canonicalSignatureSchema.nullish(),
  proposed_expires_at: canonicalInstantSchema.nullish(),
}).refine(
  (v) => covenantDeclarationWirePayloadIsBounded({
    covenant_id: v.covenant_id,
    protocol_version: v.protocol_version ?? "v1",
    sender_did: v.sender_did,
    counterparty_did: v.counterparty_did,
    vows: v.vows,
    status: v.status,
    counterparty_name: v.counterparty_name ?? null,
    notes: v.notes ?? null,
    metadata: v.metadata ?? {},
    established_at: v.established_at,
    signing_key_id: v.signing_key_id ?? null,
    signature: v.signature ?? null,
    proposed_expires_at: v.proposed_expires_at ?? null,
  }),
  { message: "covenant declaration exceeds the shared federation wire bounds" },
);

const cosignSchema = z.object({
  counterparty_did: z.string().min(1).max(255),
  counterparty_signing_key_id: canonicalSignedUuidSchema,
  counterparty_signature: canonicalSignatureSchema,
  counterparty_signed_at: canonicalInstantSchema,
});

const rejectSchema = z.object({
  rejecting_did: z.string().min(1).max(255),
  rejecter_signing_key_id: canonicalSignedUuidSchema,
  rejection_signature: canonicalSignatureSchema,
  reason: z.string().max(2000).default(""),
  rejected_at: canonicalInstantSchema,
});

const withdrawSchema = z.object({
  initiator_did: z.string().min(1).max(255),
  initiator_signing_key_id: canonicalSignedUuidSchema,
  withdraw_signature: canonicalSignatureSchema,
  withdrawn_at: canonicalInstantSchema,
});

async function ensureFederationEnabled() {
  const settings = await getSettings();
  if (!settings.enabled) {
    throw new HTTPException(404, { message: "federation_disabled" });
  }
}

app.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = inboundSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }
  // Retire omitted protocol too: v1 is the legacy default. This refusal is
  // deliberately before settings/identity/database reads or peer resolution.
  if (parsed.data.protocol_version !== "v2") {
    return fail(c, errors.covenantFederation({
      error: "v1_declaration_ingress_retired",
    }), 409);
  }
  if (!covenantV2AuthorityGeneration()) {
    return fail(c, errors.covenantFederation({
      error: "covenant_v2_authority_not_ready",
    }), 409);
  }
  await ensureFederationEnabled();
  const result = await receiveFederatedCovenant(parsed.data);
  return c.json(result.body, result.status_code as 200 | 201 | 400 | 403 | 404 | 409);
});

app.post("/:id/cosign", async (c) => {
  const id = c.req.param("id");
  if (!isCanonicalUuid(id)) {
    return fail(c, errors.covenantFederation({
      error: "invalid_covenant_id",
    }), 400);
  }
  const body = await c.req.json();
  const parsed = cosignSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }
  if (!covenantV2AuthorityGeneration()) {
    return fail(c, errors.covenantFederation({
      error: "covenant_v2_authority_not_ready",
    }), 409);
  }
  await ensureFederationEnabled();
  const result = await receiveCosign(id, parsed.data);
  return c.json(result.body, result.status_code as 200 | 201 | 400 | 403 | 404 | 409);
});

app.post("/:id/reject", async (c) => {
  const id = c.req.param("id");
  if (!isCanonicalUuid(id)) {
    return fail(c, errors.covenantFederation({
      error: "invalid_covenant_id",
    }), 400);
  }
  const body = await c.req.json();
  const parsed = rejectSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }
  if (!covenantV2AuthorityGeneration()) {
    return fail(c, errors.covenantFederation({
      error: "covenant_v2_authority_not_ready",
    }), 409);
  }
  await ensureFederationEnabled();
  const result = await receiveReject(id, parsed.data);
  return c.json(result.body, result.status_code as 200 | 201 | 400 | 403 | 404 | 409);
});

app.post("/:id/withdraw", async (c) => {
  const id = c.req.param("id");
  if (!isCanonicalUuid(id)) {
    return fail(c, errors.covenantFederation({
      error: "invalid_covenant_id",
    }), 400);
  }
  const body = await c.req.json();
  const parsed = withdrawSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }
  if (!covenantV2AuthorityGeneration()) {
    return fail(c, errors.covenantFederation({
      error: "covenant_v2_authority_not_ready",
    }), 409);
  }
  await ensureFederationEnabled();
  const result = await receiveWithdraw(id, parsed.data);
  return c.json(result.body, result.status_code as 200 | 201 | 400 | 403 | 404 | 409);
});

export default app;
