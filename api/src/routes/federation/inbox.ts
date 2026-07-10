/** POST /federation/inbox — receive a cross-instance inbox message.
 *
 *  UNAUTHENTICATED. The sender's instance posts the envelope here. We:
 *    1. Verify federation is enabled + sender's host is allowed
 *    2. Parse sender_did (must be federated form: did:at:<host>/<uuid>)
 *    3. Resolve sender's signing pubkey via the sender's instance
 *    4. Verify ed25519 signature over canonical bytes
 *    5. Look up recipient locally (must be a local DID)
 *    6. Insert into inbox.messages with sender_instance + federation_verified=true
 *
 *  Same shape as /v1/inbox POST, minus the bearer-side ownership check
 *  (replaced by federation sig + sender-instance verification).
 *
 *  Covenant gate (Horizon B, Slice 1): runs at step 5 — recipient must
 *  have an active covenant naming the federated sender DID. See
 *  docs/CROSS-INSTANCE-COVENANTS.md. */

import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { isFederatedSenderAllowed } from "../../services/covenants/check";
import { errors, fail } from "../../lib/errors";
import { db } from "../../db/client";
import { identities, identityBoxKeys } from "../../db/schema/identity";
import { inboxMessages } from "../../db/schema/inbox";
import {
  getSettings,
  isAllowedOrigin,
  parseDid,
  recordInboundPeer,
  resolveFederatedDid,
} from "../../services/federation/store";
import { publishArrival } from "../../services/inbox/push";
import { verifyInboxSignature } from "../../services/inbox/sig";

const app = new Hono();

const inboundSchema = z.object({
  sender_did: z.string().min(1).max(255),
  recipient_did: z.string().min(1).max(255),
  ciphertext: z.string().min(1).max(200_000),
  nonce: z.string().min(1).max(64),
  ephemeral_pubkey: z.string().min(1).max(64),
  recipient_box_key_id: z.string().uuid(),
  signature: z.string().min(1).max(255),
  signing_key_id: z.string().min(1).max(255),     // sender's key id (their instance issued)
  subject: z.string().max(500).nullish(),
  subject_encrypted: z.boolean().optional(),
  in_reply_to: z.string().uuid().nullish(),
  refs: z
    .array(z.object({ kind: z.string().max(32), ref: z.string().max(255) }))
    .max(32)
    .optional(),
  metadata: z.record(z.unknown()).optional(),
});

app.post("/", async (c) => {
  const settings = await getSettings();
  if (!settings.enabled) {
    throw new HTTPException(404, { message: "federation_disabled" });
  }

  const body = await c.req.json();
  const parsed = inboundSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }
  const m = parsed.data;

  // 1. Sender must be a federated DID with a host.
  let senderParsed;
  try {
    senderParsed = parseDid(m.sender_did);
  } catch (err) {
    return c.json({ error: "invalid_sender_did", detail: (err as Error).message }, 400);
  }
  if (!senderParsed.host) {
    return c.json({ error: "sender_must_be_federated" }, 400);
  }
  if (!(await isAllowedOrigin(senderParsed.host))) {
    return c.json({ error: "sender_origin_not_allowed" }, 403);
  }

  // 2. Recipient must be a LOCAL DID.
  let recipientParsed;
  try {
    recipientParsed = parseDid(m.recipient_did);
  } catch (err) {
    return c.json({ error: "invalid_recipient_did" }, 400);
  }
  // Local form: host=null. Federated form pointing to us: also accept
  // (compare to settings.instance_url's host).
  let myHost: string | null = null;
  if (settings.instance_url) {
    try {
      myHost = new URL(settings.instance_url).host;
    } catch { /* ignore */ }
  }
  if (recipientParsed.host !== null && recipientParsed.host !== myHost) {
    return c.json({ error: "recipient_not_on_this_instance" }, 400);
  }

  // 3. Resolve recipient locally.
  const [recipient] = await db
    .select({
      id: identities.id,
      did: identities.did,
      projectId: identities.projectId,
      status: identities.status,
    })
    .from(identities)
    .where(eq(identities.id, recipientParsed.uuid))
    .limit(1);
  if (!recipient || recipient.status !== "active") {
    throw new HTTPException(404, { message: "recipient_not_found" });
  }

  // 4. Recipient's box key must exist.
  const [boxKey] = await db
    .select()
    .from(identityBoxKeys)
    .where(eq(identityBoxKeys.id, m.recipient_box_key_id))
    .limit(1);
  if (!boxKey || boxKey.identityId !== recipient.id || !boxKey.active) {
    throw new HTTPException(404, { message: "recipient_box_key_not_found" });
  }

  // 5. Cross-instance covenant gate (Horizon B, Slice 1).
  // Per-DID consent: the recipient's project must have an active
  // covenant naming this federated sender. Without this, federation
  // would only gate at instance level (allowed_origins) — any allowed
  // peer could DM any local recipient. This restores the doctrine that
  // every cross-project bond — federated or not — requires a covenant.
  // Runs BEFORE the (network-bound) resolver step so misses fast-fail
  // without a peer round-trip.
  const allowed = await isFederatedSenderAllowed(
    recipient.projectId,
    [recipient.did],
    m.sender_did,
  );
  if (!allowed) {
    // Errors-as-instructions — see docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md
    return fail(c, errors.covenantRequired({ sender_did: m.sender_did, recipient_did: recipient.did }), 403);
  }

  // 6. Resolve sender's signing pubkey via federation.
  let senderResolution;
  try {
    senderResolution = await resolveFederatedDid(m.sender_did);
  } catch (err) {
    return c.json(
      { error: "sender_resolve_failed", detail: (err as Error).message },
      502,
    );
  }
  const senderKey = senderResolution.signing_keys.find((k) => k.id === m.signing_key_id);
  if (!senderKey) {
    return c.json({ error: "sender_signing_key_not_found_at_origin" }, 401);
  }

  // 7. Verify signature.
  // Canonical bytes match the local /v1/inbox shape: recipient_did is
  // included verbatim as the sender originally signed it. We accept both
  // local-form and federated-form recipient_did in the canonical bytes —
  // the sender signs whichever they used to address us.
  const ok = verifyInboxSignature({
    recipientDid: m.recipient_did,
    ciphertextB64: m.ciphertext,
    nonceB64: m.nonce,
    ephemeralPubkeyB64: m.ephemeral_pubkey,
    signatureB64: m.signature,
    publicKeyB64: senderKey.public_key,
  });
  if (!ok) {
    return c.json({ error: "signature_invalid" }, 401);
  }

  // 8. Insert.
  const [inserted] = await db
    .insert(inboxMessages)
    .values({
      recipientDid: recipient.did,
      recipientIdentityId: recipient.id,
      recipientProjectId: recipient.projectId,
      senderDid: m.sender_did,
      senderSigningKeyId: m.signing_key_id, // text id from sender's instance
      ciphertext: m.ciphertext,
      nonce: m.nonce,
      ephemeralPubkey: m.ephemeral_pubkey,
      recipientBoxKeyId: m.recipient_box_key_id,
      signature: m.signature,
      subject: m.subject ?? null,
      subjectEncrypted: m.subject_encrypted ?? false,
      inReplyTo: m.in_reply_to ?? null,
      refs: (m.refs ?? null) as unknown,
      metadata: m.metadata ?? {},
      senderInstance: senderParsed.host,
      federationVerified: true,
    })
    .returning({ id: inboxMessages.id, createdAt: inboxMessages.createdAt });

  // 9. Log peer + notify SSE subscribers (non-fatal if notify fails).
  void recordInboundPeer(senderParsed.host);
  void publishArrival(recipient.id, inserted!.id);

  return c.json(
    {
      id: inserted!.id,
      created_at: inserted!.createdAt.toISOString(),
      received: true,
      from_instance: senderParsed.host,
      encryption_verified: false,
      _note:
        "Federation origin, sender signature, recipient key identifier, and covenant were verified. Body encryption is caller-controlled and was not verified.",
    },
    201,
  );
});

export default app;
