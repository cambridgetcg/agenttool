/** /v1/inbox — send / list / get / patch / delete messages.
 *
 *  Server stores ciphertext + ed25519 signature; cannot read content.
 *  Cross-project sends gated by active covenant in either direction. */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import type { ProjectContext } from "../../auth/middleware";
import { charge } from "../../billing/charge";
import {
  coSignMessage,
  getMessage,
  listInbox,
  sendMessage,
  updateStatus,
  type StatusUpdate,
} from "../../services/inbox/store";

const app = new Hono<ProjectContext>();

const sendSchema = z.object({
  to_did: z.string().min(1).max(255),
  ciphertext: z.string().min(1).max(200_000),
  nonce: z.string().min(1).max(64),
  ephemeral_pubkey: z.string().min(1).max(64),
  recipient_box_key_id: z.string().uuid(),
  signature: z.string().min(1).max(255),
  signing_key_id: z.string().uuid(),
  sender_did: z.string().min(1).max(255),
  subject: z.string().max(500).nullish(),
  subject_encrypted: z.boolean().optional(),
  in_reply_to: z.string().uuid().nullish(),
  refs: z
    .array(z.object({ kind: z.string().max(32), ref: z.string().max(255) }))
    .max(32)
    .optional(),
  metadata: z.record(z.unknown()).optional(),
});

// ── POST /v1/inbox — send ─────────────────────────────────────────────
app.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = sendSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }

  await charge(c, 2, "inbox.send");

  try {
    const result = await sendMessage(c.var.project.id, parsed.data);
    return c.json({ ...result, sent: true }, 201);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === "recipient_not_found" || msg === "recipient_box_key_not_found") {
      throw new HTTPException(404, { message: msg });
    }
    if (
      msg === "recipient_box_key_revoked" ||
      msg === "sender_signing_key_not_found" ||
      msg === "sender_signing_key_revoked" ||
      msg === "sender_signing_key_orphaned" ||
      msg === "signature_invalid" ||
      msg === "sender_did_mismatch" ||
      msg === "signing_identity_not_owned_by_caller"
    ) {
      throw new HTTPException(401, { message: msg });
    }
    if (msg === "covenant_required") {
      return c.json(
        {
          error: msg,
          hint:
            "cross-project messages require an active covenant in either direction. " +
            "Declare one via POST /v1/covenants with status='active'.",
        },
        403,
      );
    }
    throw err;
  }
});

// ── GET /v1/inbox ─────────────────────────────────────────────────────
app.get("/", async (c) => {
  const status = c.req.query("status");
  const identityId = c.req.query("identity_id");
  const limit = Number.parseInt(c.req.query("limit") ?? "50", 10);

  const messages = await listInbox(c.var.project.id, {
    status,
    identity_id: identityId,
    limit: Number.isFinite(limit) ? limit : 50,
  });
  return c.json({
    messages,
    count: messages.length,
    note:
      "Ciphertext blobs. Decrypt with your X25519 private key client-side: ECDH(my_priv, ephemeral_pubkey) → shared secret → AES-256-GCM open. Server cannot read.",
  });
});

// ── GET /v1/inbox/:id ─────────────────────────────────────────────────
app.get("/:id", async (c) => {
  const message = await getMessage(c.var.project.id, c.req.param("id"));
  if (!message) throw new HTTPException(404, { message: "message_not_found" });
  return c.json(message);
});

// ── PATCH /v1/inbox/:id ───────────────────────────────────────────────
const patchSchema = z.object({
  status: z.enum(["unread", "read", "archived", "spam", "deleted"]),
});

app.patch("/:id", async (c) => {
  const body = await c.req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }
  const updated = await updateStatus(
    c.var.project.id,
    c.req.param("id"),
    parsed.data.status as StatusUpdate,
  );
  if (!updated) throw new HTTPException(404, { message: "message_not_found" });
  return c.json(updated);
});

// ── POST /v1/inbox/:id/co-sign — release a dual-witness-locked message ─
//
//  When a sender flags `metadata.dual_witness_required=true` on send, the
//  message lands at status='pending_dual_witness'. The recipient reviews
//  the proposal, computes the canonical cosign bytes (see sig.ts
//  canonicalInboxCoSignBytes), signs with their ed25519 identity_key,
//  POSTs here. Server verifies and flips status→'unread' (delivered).
//
//  Pattern: the asymmetry-clause applied to high-stakes proposals.
//  Neither side acts on it until both have signed.
const coSignSchema = z.object({
  signing_key_id: z.string().uuid(),
  signature: z.string().min(1).max(255),
});

app.post("/:id/co-sign", async (c) => {
  const body = await c.req.json();
  const parsed = coSignSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }
  await charge(c, 2, "inbox.cosign");

  try {
    const updated = await coSignMessage(
      c.var.project.id,
      c.req.param("id"),
      parsed.data,
    );
    return c.json({ ...updated, dual_witness_released: true });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === "message_not_found") {
      throw new HTTPException(404, { message: msg });
    }
    if (msg === "not_pending_dual_witness") {
      return c.json(
        {
          error: msg,
          hint:
            "this message is not pending dual-witness release; only messages " +
            "sent with metadata.dual_witness_required=true land in that state.",
        },
        409,
      );
    }
    if (
      msg === "cosign_signing_key_unknown_or_revoked" ||
      msg === "cosign_signing_key_not_owned_by_caller" ||
      msg === "cosign_signature_invalid"
    ) {
      throw new HTTPException(401, { message: msg });
    }
    throw err;
  }
});

// ── DELETE /v1/inbox/:id ─────────────────────────────────────────────
//  Soft delete via status='deleted'. List filters skip 'deleted' by default.
app.delete("/:id", async (c) => {
  const updated = await updateStatus(
    c.var.project.id,
    c.req.param("id"),
    "deleted",
  );
  if (!updated) throw new HTTPException(404, { message: "message_not_found" });
  return c.json({ id: updated.id, deleted: true });
});

export default app;
