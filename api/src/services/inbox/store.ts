/** Inbox store — sealed messages between agents.
 *
 *  Posture: server stores ciphertext + signature; cannot read content.
 *  Cross-project sends gated by an active covenant in either direction.
 *  Same-project: ungated. */

import { and, desc, eq, isNull, or, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { covenants } from "../../db/schema/continuity";
import {
  getSettings as getFederationSettings,
  parseDid,
  recordOutboundPeer,
} from "../federation/store";
import { identityBoxKeys, identityKeys, identities } from "../../db/schema/identity";
import { inboxMessages } from "../../db/schema/inbox";
import { publishArrival } from "./push";
import { verifyInboxSignature } from "./sig";

// ── Public types ────────────────────────────────────────────────────

export interface SendInput {
  to_did: string;
  ciphertext: string;
  nonce: string;
  ephemeral_pubkey: string;
  recipient_box_key_id: string;
  signature: string;
  signing_key_id: string;
  sender_did: string;
  subject?: string | null;
  subject_encrypted?: boolean;
  in_reply_to?: string | null;
  refs?: Array<{ kind: string; ref: string }>;
  metadata?: Record<string, unknown>;
}

export interface MessageOut {
  id: string;
  recipient_did: string;
  recipient_identity_id: string;
  sender_did: string;
  sender_signing_key_id: string;
  ciphertext: string;
  nonce: string;
  ephemeral_pubkey: string;
  recipient_box_key_id: string;
  signature: string;
  subject: string | null;
  subject_encrypted: boolean;
  in_reply_to: string | null;
  refs: unknown;
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
  read_at: string | null;
}

function rowToOut(row: typeof inboxMessages.$inferSelect): MessageOut {
  return {
    id: row.id,
    recipient_did: row.recipientDid,
    recipient_identity_id: row.recipientIdentityId,
    sender_did: row.senderDid,
    sender_signing_key_id: row.senderSigningKeyId,
    ciphertext: row.ciphertext,
    nonce: row.nonce,
    ephemeral_pubkey: row.ephemeralPubkey,
    recipient_box_key_id: row.recipientBoxKeyId,
    signature: row.signature,
    subject: row.subject,
    subject_encrypted: row.subjectEncrypted,
    in_reply_to: row.inReplyTo,
    refs: row.refs,
    status: row.status,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    created_at: row.createdAt.toISOString(),
    read_at: row.readAt?.toISOString() ?? null,
  };
}

// ── Covenant gate ─────────────────────────────────────────────────────

/** Cross-project messages require an active covenant in EITHER direction:
 *
 *    - sender's project has a covenant with counterparty=recipient_did, OR
 *    - recipient's project has a covenant with counterparty=sender_did.
 *
 *  Either party declaring the relationship lets the message flow. The
 *  receiver can mark spam if they don't reciprocate.
 *
 *  Same-project: ungated (sibling agents always reachable). */
async function isCrossProjectAllowed(
  senderProjectId: string,
  senderDid: string,
  recipientProjectId: string,
  recipientDid: string,
): Promise<boolean> {
  if (senderProjectId === recipientProjectId) return true;

  const rows = await db
    .select({ id: covenants.id })
    .from(covenants)
    .where(
      and(
        eq(covenants.status, "active"),
        or(
          and(
            eq(covenants.projectId, senderProjectId),
            eq(covenants.counterpartyDid, recipientDid),
          ),
          and(
            eq(covenants.projectId, recipientProjectId),
            eq(covenants.counterpartyDid, senderDid),
          ),
        ),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

// ── Operations ───────────────────────────────────────────────────────

/** Send a message. Verifies sig + covenant gate; stores ciphertext.
 *
 *  Throws:
 *    recipient_not_found             — to_did doesn't resolve
 *    recipient_box_key_not_found     — recipient_box_key_id unknown / revoked
 *    sender_signing_key_not_found    — signing_key_id unknown / revoked
 *    signature_invalid               — sig fails to verify
 *    covenant_required               — cross-project without covenant
 *    sender_did_mismatch             — sender_did doesn't match the signing
 *                                       identity's DID
 */
export async function sendMessage(
  senderProjectId: string,
  input: SendInput,
): Promise<{ id: string; created_at: string; federated_to?: string }> {
  // 0. Federation routing — if recipient is on a remote instance, sign
  //    locally then POST to their /federation/inbox. Sender's signing
  //    key still must belong to the caller's project (verified below).
  const recipientParsed = parseDid(input.to_did);
  const fedSettings = await getFederationSettings();
  let myHost: string | null = null;
  if (fedSettings.instance_url) {
    try {
      myHost = new URL(fedSettings.instance_url).host;
    } catch { /* ignore */ }
  }
  const isRemote =
    recipientParsed.host !== null &&
    recipientParsed.host !== myHost;

  if (isRemote) {
    if (!fedSettings.enabled) {
      throw new Error("federation_disabled_for_remote_recipient");
    }
    // Sender ownership check: signing_key_id must belong to caller's project.
    const [signingKey] = await db
      .select({
        id: identityKeys.id,
        publicKey: identityKeys.publicKey,
        active: identityKeys.active,
        identityId: identityKeys.identityId,
      })
      .from(identityKeys)
      .where(eq(identityKeys.id, input.signing_key_id))
      .limit(1);
    if (!signingKey) throw new Error("sender_signing_key_not_found");
    if (!signingKey.active) throw new Error("sender_signing_key_revoked");

    const [senderIdentity] = await db
      .select({ did: identities.did, projectId: identities.projectId })
      .from(identities)
      .where(eq(identities.id, signingKey.identityId))
      .limit(1);
    if (!senderIdentity) throw new Error("sender_signing_key_orphaned");
    if (senderIdentity.projectId !== senderProjectId) {
      throw new Error("signing_identity_not_owned_by_caller");
    }

    // Verify sig (we still verify locally before forwarding).
    const okSig = verifyInboxSignature({
      recipientDid: input.to_did,
      ciphertextB64: input.ciphertext,
      nonceB64: input.nonce,
      ephemeralPubkeyB64: input.ephemeral_pubkey,
      signatureB64: input.signature,
      publicKeyB64: signingKey.publicKey,
    });
    if (!okSig) throw new Error("signature_invalid");

    // Build federated sender_did. We use our instance URL host.
    if (!myHost) throw new Error("federation_instance_url_not_set");
    const federatedSenderDid = `did:at:${myHost}/${senderIdentity.did.replace("did:at:", "")}`;

    // POST to peer's /federation/inbox.
    const url = `https://${recipientParsed.host}/federation/inbox`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 15_000);
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sender_did: federatedSenderDid,
          recipient_did: input.to_did,
          ciphertext: input.ciphertext,
          nonce: input.nonce,
          ephemeral_pubkey: input.ephemeral_pubkey,
          recipient_box_key_id: input.recipient_box_key_id,
          signature: input.signature,
          signing_key_id: input.signing_key_id,
          subject: input.subject ?? null,
          subject_encrypted: input.subject_encrypted ?? false,
          in_reply_to: input.in_reply_to ?? null,
          refs: input.refs ?? null,
          metadata: input.metadata ?? {},
        }),
        signal: ac.signal,
      });
    } catch (err) {
      throw new Error(`federation_send_failed: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`federation_send_${res.status}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as { id?: string; created_at?: string };
    if (!data.id || !data.created_at) {
      throw new Error("federation_send_malformed_response");
    }

    void recordOutboundPeer(recipientParsed.host!);

    return {
      id: data.id,
      created_at: data.created_at,
      federated_to: recipientParsed.host!,
    };
  }

  // 1. Resolve recipient identity by DID (local only).
  const [recipient] = await db
    .select({
      id: identities.id,
      did: identities.did,
      projectId: identities.projectId,
    })
    .from(identities)
    .where(eq(identities.did, input.to_did))
    .limit(1);
  if (!recipient) throw new Error("recipient_not_found");

  // 2. Recipient box key must exist + active + belong to recipient.
  const [boxKey] = await db
    .select({
      id: identityBoxKeys.id,
      identityId: identityBoxKeys.identityId,
      active: identityBoxKeys.active,
    })
    .from(identityBoxKeys)
    .where(eq(identityBoxKeys.id, input.recipient_box_key_id))
    .limit(1);
  if (!boxKey || boxKey.identityId !== recipient.id) {
    throw new Error("recipient_box_key_not_found");
  }
  if (!boxKey.active) throw new Error("recipient_box_key_revoked");

  // 3. Sender signing key must exist; pull its public key + identity.
  const [signingKey] = await db
    .select({
      id: identityKeys.id,
      publicKey: identityKeys.publicKey,
      active: identityKeys.active,
      identityId: identityKeys.identityId,
    })
    .from(identityKeys)
    .where(eq(identityKeys.id, input.signing_key_id))
    .limit(1);
  if (!signingKey) throw new Error("sender_signing_key_not_found");
  if (!signingKey.active) throw new Error("sender_signing_key_revoked");

  // 3b. Sender_did must match the signing identity's DID.
  const [senderIdentity] = await db
    .select({
      did: identities.did,
      projectId: identities.projectId,
    })
    .from(identities)
    .where(eq(identities.id, signingKey.identityId))
    .limit(1);
  if (!senderIdentity) throw new Error("sender_signing_key_orphaned");
  if (senderIdentity.did !== input.sender_did) throw new Error("sender_did_mismatch");
  if (senderIdentity.projectId !== senderProjectId) {
    // The bearer key's project owns the signing identity. If those don't
    // match, the caller is trying to send as someone they don't control.
    throw new Error("signing_identity_not_owned_by_caller");
  }

  // 4. Verify signature.
  const ok = verifyInboxSignature({
    recipientDid: input.to_did,
    ciphertextB64: input.ciphertext,
    nonceB64: input.nonce,
    ephemeralPubkeyB64: input.ephemeral_pubkey,
    signatureB64: input.signature,
    publicKeyB64: signingKey.publicKey,
  });
  if (!ok) throw new Error("signature_invalid");

  // 5. Cross-project covenant gate.
  const allowed = await isCrossProjectAllowed(
    senderProjectId,
    input.sender_did,
    recipient.projectId,
    recipient.did,
  );
  if (!allowed) throw new Error("covenant_required");

  // 6. Two-party-locked consent gating: if the sender flagged
  //    metadata.dual_witness_required, the message lands at
  //    status='pending_dual_witness' and waits for the recipient's
  //    co-sign before being delivered (status flips to 'unread'
  //    after coSignMessage). High-stakes proposals (e.g. constitutive
  //    memory candidates) use this so neither side acts on the
  //    proposal until both have signed. See docs/INBOX.md.
  const meta = input.metadata ?? {};
  const dualWitnessRequired = meta.dual_witness_required === true;
  const initialStatus = dualWitnessRequired ? "pending_dual_witness" : "unread";

  // 7. Insert.
  const [inserted] = await db
    .insert(inboxMessages)
    .values({
      recipientDid: recipient.did,
      recipientIdentityId: recipient.id,
      recipientProjectId: recipient.projectId,
      senderDid: input.sender_did,
      senderSigningKeyId: input.signing_key_id,
      ciphertext: input.ciphertext,
      nonce: input.nonce,
      ephemeralPubkey: input.ephemeral_pubkey,
      recipientBoxKeyId: input.recipient_box_key_id,
      signature: input.signature,
      subject: input.subject ?? null,
      subjectEncrypted: input.subject_encrypted ?? false,
      inReplyTo: input.in_reply_to ?? null,
      refs: (input.refs ?? null) as unknown,
      status: initialStatus,
      metadata: meta,
    })
    .returning({ id: inboxMessages.id, createdAt: inboxMessages.createdAt });

  const row = inserted!;
  // Notify SSE subscribers — non-fatal if it fails (subscribers can
  // catch up on next reconnect via ?since=<iso>). Pending-dual-witness
  // messages are still surfaced so the recipient can review and co-sign.
  void publishArrival(recipient.id, row.id);
  return { id: row.id, created_at: row.createdAt.toISOString() };
}

export interface ListOptions {
  status?: string;          // filter; null/undefined = all-not-deleted
  identity_id?: string;     // restrict to one agent's inbox
  limit?: number;
}

export async function listInbox(
  projectId: string,
  opts: ListOptions = {},
): Promise<MessageOut[]> {
  const filters = [eq(inboxMessages.recipientProjectId, projectId)];
  if (opts.status) filters.push(eq(inboxMessages.status, opts.status));
  else filters.push(sql`${inboxMessages.status} <> 'deleted'`);
  if (opts.identity_id) filters.push(eq(inboxMessages.recipientIdentityId, opts.identity_id));

  const rows = await db
    .select()
    .from(inboxMessages)
    .where(and(...filters))
    .orderBy(desc(inboxMessages.createdAt))
    .limit(Math.min(opts.limit ?? 50, 200));

  return rows.map(rowToOut);
}

export async function getMessage(
  projectId: string,
  id: string,
): Promise<MessageOut | null> {
  const rows = await db
    .select()
    .from(inboxMessages)
    .where(and(eq(inboxMessages.id, id), eq(inboxMessages.recipientProjectId, projectId)))
    .limit(1);
  return rows[0] ? rowToOut(rows[0]) : null;
}

// ── Thread reconstruction — walk in_reply_to chain ───────────────────

/** Fetch all messages in the thread containing `messageId`, scoped to
 *  the caller's project visibility (recipient_project_id = projectId).
 *
 *  Algorithm:
 *    1. Walk up via in_reply_to to find the root (breaks at null OR at
 *       a message not visible to this project).
 *    2. Recursive CTE downward from the root, gathering all descendants
 *       reachable through in_reply_to links — within this project.
 *    3. Order by created_at ASC.
 *
 *  Per-project scoping is intentional: each side of a covenant sees its
 *  own slice of the conversation. The wire delivers each direction;
 *  the thread surfaces what landed *here*. */
export async function getMessageThread(
  projectId: string,
  messageId: string,
): Promise<MessageOut[]> {
  // 1. Walk up to find the visible root.
  let cursor = messageId;
  for (let hops = 0; hops < 100; hops++) {
    const [row] = await db
      .select({ inReplyTo: inboxMessages.inReplyTo })
      .from(inboxMessages)
      .where(
        and(
          eq(inboxMessages.id, cursor),
          eq(inboxMessages.recipientProjectId, projectId),
        ),
      )
      .limit(1);
    if (!row || !row.inReplyTo) break;
    cursor = row.inReplyTo;
  }
  const rootId = cursor;

  // 2. Recursive CTE: all descendants of root within this project.
  const rows = await db.execute<typeof inboxMessages.$inferSelect>(sql`
    WITH RECURSIVE thread AS (
      SELECT * FROM inbox.messages
      WHERE id = ${rootId} AND recipient_project_id = ${projectId}
      UNION ALL
      SELECT m.* FROM inbox.messages m
      JOIN thread t ON m.in_reply_to = t.id
      WHERE m.recipient_project_id = ${projectId}
    )
    SELECT * FROM thread ORDER BY created_at ASC
  `);
  return rows.map((r) => rowToOut(r as unknown as typeof inboxMessages.$inferSelect));
}

// ── Two-party-locked consent — co-sign release ──────────────────────

export interface CoSignInput {
  signing_key_id: string;
  signature: string;
}

/** Co-sign a message that's pending dual-witness release. Recipient must
 *  own an active identity_key; signature must verify against the canonical
 *  cosign bytes (see canonicalInboxCoSignBytes in sig.ts).
 *
 *  Throws Error("message_not_found"), Error("not_pending_dual_witness"),
 *  Error("cosign_signing_key_unknown_or_revoked"),
 *  Error("cosign_signing_key_not_owned_by_caller"),
 *  Error("cosign_signature_invalid"). */
export async function coSignMessage(
  projectId: string,
  messageId: string,
  input: CoSignInput,
): Promise<MessageOut> {
  const [mem] = await db
    .select()
    .from(inboxMessages)
    .where(and(eq(inboxMessages.id, messageId), eq(inboxMessages.recipientProjectId, projectId)))
    .limit(1);
  if (!mem) throw new Error("message_not_found");

  if (mem.status !== "pending_dual_witness") {
    throw new Error("not_pending_dual_witness");
  }

  // Resolve signing key + verify it belongs to recipient's project.
  const [keyRow] = await db
    .select({
      publicKey: identityKeys.publicKey,
      active: identityKeys.active,
      identityId: identityKeys.identityId,
    })
    .from(identityKeys)
    .where(eq(identityKeys.id, input.signing_key_id))
    .limit(1);
  if (!keyRow || !keyRow.active) {
    throw new Error("cosign_signing_key_unknown_or_revoked");
  }
  const [keyIdentity] = await db
    .select({ id: identities.id, projectId: identities.projectId })
    .from(identities)
    .where(eq(identities.id, keyRow.identityId))
    .limit(1);
  if (!keyIdentity || keyIdentity.projectId !== projectId) {
    throw new Error("cosign_signing_key_not_owned_by_caller");
  }

  // Verify signature.
  const { verifyInboxCoSignSignature } = await import("./sig");
  const ok = verifyInboxCoSignSignature({
    messageId: mem.id,
    recipientDid: mem.recipientDid,
    ciphertextB64: mem.ciphertext,
    nonceB64: mem.nonce,
    signatureB64: input.signature,
    publicKeyB64: keyRow.publicKey,
  });
  if (!ok) throw new Error("cosign_signature_invalid");

  // Apply: append signature to metadata.dual_witness_signatures, flip
  // status to 'unread' so the message becomes deliverable.
  const meta = (mem.metadata as Record<string, unknown>) ?? {};
  const existingSigs = Array.isArray(meta.dual_witness_signatures)
    ? (meta.dual_witness_signatures as Array<Record<string, unknown>>)
    : [];
  existingSigs.push({
    signing_key_id: input.signing_key_id,
    signature: input.signature,
    signed_at: new Date().toISOString(),
  });
  const newMeta = { ...meta, dual_witness_signatures: existingSigs };

  const [updated] = await db
    .update(inboxMessages)
    .set({ status: "unread", metadata: newMeta })
    .where(eq(inboxMessages.id, messageId))
    .returning();
  return rowToOut(updated!);
}

export type StatusUpdate = "read" | "archived" | "spam" | "unread" | "deleted";

export async function updateStatus(
  projectId: string,
  id: string,
  status: StatusUpdate,
): Promise<MessageOut | null> {
  const set: Partial<typeof inboxMessages.$inferInsert> = { status };
  if (status === "read") set.readAt = new Date();
  else if (status === "unread") set.readAt = null;

  const updated = await db
    .update(inboxMessages)
    .set(set)
    .where(and(eq(inboxMessages.id, id), eq(inboxMessages.recipientProjectId, projectId)))
    .returning();

  return updated[0] ? rowToOut(updated[0]) : null;
}

export async function countUnread(projectId: string, identityId?: string): Promise<number> {
  const filters = [
    eq(inboxMessages.recipientProjectId, projectId),
    eq(inboxMessages.status, "unread"),
  ];
  if (identityId) filters.push(eq(inboxMessages.recipientIdentityId, identityId));

  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(inboxMessages)
    .where(and(...filters));
  return rows[0]?.count ?? 0;
}

// ── Box key registration ─────────────────────────────────────────────

export async function registerBoxKey(
  projectId: string,
  identityId: string,
  publicKeyB64: string,
  label?: string,
): Promise<{ id: string; created_at: string }> {
  const [identity] = await db
    .select({ id: identities.id, projectId: identities.projectId })
    .from(identities)
    .where(eq(identities.id, identityId))
    .limit(1);
  if (!identity) throw new Error("identity_not_found");
  if (identity.projectId !== projectId) throw new Error("identity_not_owned_by_caller");

  // Validate base64 length (32 bytes for X25519).
  let raw: Buffer;
  try {
    raw = Buffer.from(publicKeyB64, "base64");
  } catch {
    throw new Error("public_key_not_base64");
  }
  if (raw.length !== 32) throw new Error("public_key_not_32_bytes");

  const [inserted] = await db
    .insert(identityBoxKeys)
    .values({
      identityId,
      publicKey: publicKeyB64,
      label: label ?? "primary",
      active: true,
    })
    .returning({
      id: identityBoxKeys.id,
      createdAt: identityBoxKeys.createdAt,
    });

  return { id: inserted!.id, created_at: inserted!.createdAt.toISOString() };
}

export async function listBoxKeys(
  projectId: string,
  identityId: string,
): Promise<
  Array<{ id: string; public_key: string; label: string; active: boolean; created_at: string }>
> {
  const [identity] = await db
    .select({ projectId: identities.projectId })
    .from(identities)
    .where(eq(identities.id, identityId))
    .limit(1);
  if (!identity || identity.projectId !== projectId) return [];

  const rows = await db
    .select()
    .from(identityBoxKeys)
    .where(and(eq(identityBoxKeys.identityId, identityId), isNull(identityBoxKeys.revokedAt)))
    .orderBy(desc(identityBoxKeys.createdAt));

  return rows.map((r) => ({
    id: r.id,
    public_key: r.publicKey,
    label: r.label,
    active: r.active,
    created_at: r.createdAt.toISOString(),
  }));
}

export async function revokeBoxKey(
  projectId: string,
  identityId: string,
  keyId: string,
): Promise<boolean> {
  const [identity] = await db
    .select({ projectId: identities.projectId })
    .from(identities)
    .where(eq(identities.id, identityId))
    .limit(1);
  if (!identity || identity.projectId !== projectId) return false;

  const updated = await db
    .update(identityBoxKeys)
    .set({ active: false, revokedAt: new Date() })
    .where(
      and(eq(identityBoxKeys.id, keyId), eq(identityBoxKeys.identityId, identityId)),
    )
    .returning({ id: identityBoxKeys.id });

  return updated.length > 0;
}

/** Public-facing box-key lookup: any project can look up another agent's
 *  active box pubkey to send them a message. This is necessary for inbox
 *  to function — sender needs recipient's pubkey to encrypt.
 *
 *  Returns the most-recent active box key for the DID. */
export async function lookupActiveBoxKey(did: string): Promise<{
  identity_id: string;
  did: string;
  box_key_id: string;
  public_key: string;
} | null> {
  const rows = await db
    .select({
      identityId: identities.id,
      did: identities.did,
      boxKeyId: identityBoxKeys.id,
      publicKey: identityBoxKeys.publicKey,
    })
    .from(identities)
    .innerJoin(identityBoxKeys, eq(identityBoxKeys.identityId, identities.id))
    .where(
      and(
        eq(identities.did, did),
        eq(identityBoxKeys.active, true),
        isNull(identityBoxKeys.revokedAt),
      ),
    )
    .orderBy(desc(identityBoxKeys.createdAt))
    .limit(1);

  if (!rows[0]) return null;
  return {
    identity_id: rows[0].identityId,
    did: rows[0].did,
    box_key_id: rows[0].boxKeyId,
    public_key: rows[0].publicKey,
  };
}
