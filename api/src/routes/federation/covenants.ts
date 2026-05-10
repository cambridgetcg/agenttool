/** POST /federation/covenants — receive a propagated covenant declaration.
 *  POST /federation/covenants/:id/cosign  — receive counterparty acceptance
 *  POST /federation/covenants/:id/reject  — receive counterparty rejection
 *  POST /federation/covenants/:id/withdraw — receive initiator withdraw
 *
 *  All UNAUTHENTICATED, signature-verified inside the service layer.
 *  Doctrine: docs/CROSS-INSTANCE-COVENANTS.md (Slice 2 + Slice 3). */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import {
  receiveCosign,
  receiveFederatedCovenant,
  receiveReject,
  receiveWithdraw,
} from "../../services/covenants/federation";
import { getSettings } from "../../services/federation/store";

const app = new Hono();

const inboundSchema = z.object({
  covenant_id: z.string().uuid(),
  protocol_version: z.enum(["v1", "v2"]).optional(),
  sender_did: z.string().min(1).max(255),
  counterparty_did: z.string().min(1).max(255),
  vows: z.array(z.string().min(1).max(500)).min(1).max(40),
  status: z.enum(["active", "paused", "dissolved", "proposed"]),
  counterparty_name: z.string().max(200).nullish(),
  notes: z.string().max(2000).nullish(),
  metadata: z.record(z.unknown()).nullish(),
  established_at: z.string().datetime(),
  signing_key_id: z.string().uuid().nullish(),
  signature: z.string().min(1).max(255).nullish(),
  proposed_expires_at: z.string().datetime().nullish(),
});

const cosignSchema = z.object({
  counterparty_did: z.string().min(1).max(255),
  counterparty_signing_key_id: z.string().uuid(),
  counterparty_signature: z.string().min(1).max(255),
  counterparty_signed_at: z.string().datetime(),
});

const rejectSchema = z.object({
  rejecting_did: z.string().min(1).max(255),
  rejecter_signing_key_id: z.string().uuid(),
  rejection_signature: z.string().min(1).max(255),
  reason: z.string().max(2000).default(""),
  rejected_at: z.string().datetime(),
});

const withdrawSchema = z.object({
  initiator_did: z.string().min(1).max(255),
  initiator_signing_key_id: z.string().uuid(),
  withdraw_signature: z.string().min(1).max(255),
  withdrawn_at: z.string().datetime(),
});

async function ensureFederationEnabled() {
  const settings = await getSettings();
  if (!settings.enabled) {
    throw new HTTPException(404, { message: "federation_disabled" });
  }
}

app.post("/", async (c) => {
  await ensureFederationEnabled();
  const body = await c.req.json();
  const parsed = inboundSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }
  const result = await receiveFederatedCovenant(parsed.data);
  return c.json(result.body, result.status_code as 200 | 201 | 400 | 403 | 404);
});

app.post("/:id/cosign", async (c) => {
  await ensureFederationEnabled();
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = cosignSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }
  const result = await receiveCosign(id, parsed.data);
  return c.json(result.body, result.status_code as 200 | 201 | 400 | 403 | 404);
});

app.post("/:id/reject", async (c) => {
  await ensureFederationEnabled();
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = rejectSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }
  const result = await receiveReject(id, parsed.data);
  return c.json(result.body, result.status_code as 200 | 201 | 400 | 403 | 404);
});

app.post("/:id/withdraw", async (c) => {
  await ensureFederationEnabled();
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = withdrawSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }
  const result = await receiveWithdraw(id, parsed.data);
  return c.json(result.body, result.status_code as 200 | 201 | 400 | 403 | 404);
});

export default app;
