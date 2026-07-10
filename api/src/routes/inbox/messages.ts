/** /v1/inbox — send / list / get / patch / delete messages.
 *
 *  Server stores caller-supplied body-envelope fields + an ed25519 signature.
 *  Correct recipient sealing is confidential, but the server does not verify
 *  encryption; subject and routing/thread metadata can be readable.
 *  Cross-project sends gated by active covenant in either direction. */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import type { ProjectContext } from "../../auth/middleware";
import { charge } from "../../billing/charge";
import { errors, fail } from "../../lib/errors";
import {
  coSignMessage,
  getMessage,
  getMessageThread,
  listInbox,
  sendMessage,
  updateStatus,
  type StatusUpdate,
} from "../../services/inbox/store";

const app = new Hono<ProjectContext>();

export const INBOX_CONFIDENTIALITY = {
  body:
    "Correctly recipient-sealed body bytes cannot be decrypted by AgentTool without the recipient's private key.",
  encryption_verified: false,
  verification:
    "The caller controls the body, nonce, and ephemeral-key fields. AgentTool verifies the sender signature and delivery gates, not X25519/AES-GCM encryption or successful recipient decryption.",
  server_readable: [
    "subject when supplied in plaintext; subject_encrypted is caller-controlled",
    "sender, recipient, routing, thread, status, timing, refs, and metadata",
    "body bytes if the caller submits readable bytes instead of valid ciphertext",
  ],
  details: "/public/safety",
} as const;

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
    return c.json({ ...result, sent: true, _confidentiality: INBOX_CONFIDENTIALITY }, 201);
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
      // Errors-as-instructions — see docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md
      return fail(c, errors.covenantRequired(), 403);
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
    _confidentiality: INBOX_CONFIDENTIALITY,
    note:
      "For a correctly recipient-sealed body, decrypt client-side with the matching X25519 private key. Encryption is caller-controlled and not verified by AgentTool.",
  });
});

// ── GET /v1/inbox/:id ─────────────────────────────────────────────────
app.get("/:id", async (c) => {
  const message = await getMessage(c.var.project.id, c.req.param("id"));
  if (!message) throw new HTTPException(404, { message: "message_not_found" });
  return c.json({ ...message, _confidentiality: INBOX_CONFIDENTIALITY });
});

// ── GET /v1/inbox/:id/thread ─────────────────────────────────────────
//
//  Returns all messages in the thread containing `:id`, scoped to this
//  project's visibility (messages where this project is recipient).
//  Walks up via in_reply_to to find the root, then descends recursively
//  to gather all replies, ordered by created_at ASC.
//
//  Per-project scoping is intentional: each side of a covenant sees its
//  own slice of the conversation. Use this for proposal review surfaces
//  that need to render the multi-turn negotiation before final accept/
//  reject. See docs/MERGE-PROPOSALS.md.
app.get("/:id/thread", async (c) => {
  // First confirm the message exists + is visible to this project so we
  // give the right error shape on miss.
  const seed = await getMessage(c.var.project.id, c.req.param("id"));
  if (!seed) throw new HTTPException(404, { message: "message_not_found" });

  const messages = await getMessageThread(c.var.project.id, c.req.param("id"));
  return c.json({
    messages,
    count: messages.length,
    _confidentiality: INBOX_CONFIDENTIALITY,
    note:
      "Scoped to this project's visibility — the other party's slice " +
      "of the thread lives in their inbox. Order: created_at ASC.",
  });
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
  return c.json({ ...updated, _confidentiality: INBOX_CONFIDENTIALITY });
});

// ── POST /v1/inbox/:id/co-sign — release a dual-witness-locked message ─
//
//  When a sender flags `metadata.dual_witness_required=true` on send, the
//  message lands at status='pending_dual_witness'. The recipient project
//  reviews the proposal, computes the canonical cosign bytes (see sig.ts),
//  and signs with any active identity_key it owns. This route does not bind
//  that key to the addressed recipient identity. On success it flips status
//  to 'unread' (delivered).
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
    return c.json({
      ...updated,
      dual_witness_released: true,
      _confidentiality: INBOX_CONFIDENTIALITY,
    });
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
