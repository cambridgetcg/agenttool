/** Inbox push — Postgres LISTEN/NOTIFY backplane for cross-agent
 *  message arrival.
 *
 *  Mirrors services/strand/voice.ts. The mechanism:
 *
 *    1. sendMessage() in services/inbox/store.ts publishes after the
 *       row commits:
 *         SELECT pg_notify('agenttool_inbox_arrival',
 *                          '{recipient_identity_id, message_id}')
 *
 *    2. routes/federation/inbox.ts publishes after a federated row
 *       commits — same channel, same payload shape. Federation and
 *       local sends fan out through the same backplane.
 *
 *    3. This module listens on that channel via a dedicated postgres-js
 *       connection at process start (lazy-init on first SSE connection).
 *       On NOTIFY, it fetches the inboxMessage row and fans out to
 *       per-identity sinks registered locally.
 *
 *    4. SSE route handlers register a sink, run a catchup phase from
 *       since (ISO timestamp), then idle on the local pub/sub.
 *
 *  Multi-instance correctness: NOTIFY is broadcast across every
 *  connection in the same database. So if instance A handles the POST
 *  and instance B has the SSE subscriber, instance B's LISTEN handler
 *  fires and serves its sink. Same durability guarantee as strand
 *  voice.
 *
 *  Confidentiality: sinks see the caller-supplied body envelope. Correctly
 *  recipient-sealed bytes require the recipient's private key to decrypt,
 *  but this service does not verify encryption or hide envelope metadata. */

import { eq, sql as drizzleSql } from "drizzle-orm";
import postgres from "postgres";

import { config } from "../../config.ts";
import { db } from "../../db/client.ts";
import { inboxMessages } from "../../db/schema/inbox.ts";

const CHANNEL = "agenttool_inbox_arrival";
export const SUBS_PER_IDENTITY_CAP = 5;
export const BACKPRESSURE_QUEUE_CAP = 100;

// ── Sink — per-subscriber queue with backpressure ────────────────────

export interface InboxEvent {
  event: string;
  data: string;
  id?: string;
}

export class InboxSink {
  private queue: InboxEvent[] = [];
  private draining = false;
  private aborted = false;
  private onAbortCallbacks: Array<() => void> = [];

  constructor(
    public readonly identityId: string,
    public readonly projectId: string,
    private readonly write: (event: InboxEvent) => Promise<void>,
  ) {}

  enqueue(event: InboxEvent): boolean {
    if (this.aborted) return false;
    if (this.queue.length >= BACKPRESSURE_QUEUE_CAP) return false;
    this.queue.push(event);
    if (!this.draining) {
      void this.drain();
    }
    return true;
  }

  private async drain(): Promise<void> {
    this.draining = true;
    while (!this.aborted && this.queue.length > 0) {
      const event = this.queue.shift()!;
      try {
        await this.write(event);
      } catch {
        this.aborted = true;
        for (const cb of this.onAbortCallbacks) cb();
      }
    }
    this.draining = false;
  }

  abort(): void {
    if (this.aborted) return;
    this.aborted = true;
    this.queue.length = 0;
    for (const cb of this.onAbortCallbacks) cb();
  }

  isAborted(): boolean {
    return this.aborted;
  }

  onAbort(cb: () => void): void {
    if (this.aborted) cb();
    else this.onAbortCallbacks.push(cb);
  }
}

// ── Local fan-out registry ───────────────────────────────────────────

const sinksByIdentity = new Map<string, Set<InboxSink>>();

export function subscribeSink(sink: InboxSink): { ok: boolean; reason?: string } {
  let set = sinksByIdentity.get(sink.identityId);
  if (!set) {
    set = new Set();
    sinksByIdentity.set(sink.identityId, set);
  }
  if (set.size >= SUBS_PER_IDENTITY_CAP) {
    return { ok: false, reason: "subscriber_cap_reached" };
  }
  set.add(sink);
  sink.onAbort(() => unsubscribeSink(sink));
  return { ok: true };
}

export function unsubscribeSink(sink: InboxSink): void {
  const set = sinksByIdentity.get(sink.identityId);
  if (!set) return;
  set.delete(sink);
  if (set.size === 0) sinksByIdentity.delete(sink.identityId);
}

export function identitySubscriberCount(identityId: string): number {
  return sinksByIdentity.get(identityId)?.size ?? 0;
}

// ── LISTEN side: dedicated connection, lazy-init ────────────────────

let listenSql: ReturnType<typeof postgres> | null = null;
let listenInitPromise: Promise<void> | null = null;

export async function ensureInboxListening(): Promise<void> {
  if (listenSql) return;
  if (listenInitPromise) return listenInitPromise;
  listenInitPromise = (async () => {
    // Session pooler — LISTEN/NOTIFY needs a connection that survives
    // across statements. Tx pooler multiplexes across transactions and
    // can drop the LISTEN registration silently. Falls back to
    // databaseUrl if DATABASE_SESSION_URL isn't set (local dev).
    const conn = postgres(config.databaseSessionUrl, {
      max: 1,
      idle_timeout: 0,
      connect_timeout: 10,
    });
    await conn.listen(CHANNEL, (payload) => {
      void handleNotify(payload);
    });
    listenSql = conn;
    console.log(`[inbox-push] LISTEN ${CHANNEL} (inbox push backplane up)`);
  })();
  return listenInitPromise;
}

interface NotifyPayload {
  recipient_identity_id: string;
  message_id: string;
}

async function handleNotify(rawPayload: string): Promise<void> {
  let payload: NotifyPayload;
  try {
    payload = JSON.parse(rawPayload) as NotifyPayload;
  } catch {
    return;
  }
  const { recipient_identity_id, message_id } = payload;
  if (!recipient_identity_id || !message_id) return;

  const sinks = sinksByIdentity.get(recipient_identity_id);
  if (!sinks || sinks.size === 0) return;

  // Fetch the message row (ciphertext + metadata; we never decrypt).
  // Done once and broadcast to all local sinks for this identity.
  const rows = await db
    .select()
    .from(inboxMessages)
    .where(eq(inboxMessages.id, message_id))
    .limit(1);
  const row = rows[0];
  if (!row) return;

  const wire = JSON.stringify(messageToWire(row));
  const eventId = row.id;

  for (const sink of [...sinks]) {
    const accepted = sink.enqueue({ event: "arrival", data: wire, id: eventId });
    if (!accepted) {
      try {
        const reason = sink.isAborted() ? "aborted" : "backpressure";
        sink.enqueue({
          event: "disconnect",
          data: JSON.stringify({ reason, hint: "reconnect with ?since=<iso>" }),
        });
      } catch {
        /* ignore */
      }
      sink.abort();
    }
  }
}

// Shape inbox rows for SSE wire.
export function messageToWire(row: typeof inboxMessages.$inferSelect) {
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
    metadata: row.metadata,
    created_at: row.createdAt.toISOString(),
  };
}

// ── PUBLISH side — used by sendMessage() and federation/inbox ───────

export async function publishArrival(
  recipientIdentityId: string,
  messageId: string,
): Promise<void> {
  try {
    await db.execute(
      drizzleSql`SELECT pg_notify(${CHANNEL}, ${JSON.stringify({
        recipient_identity_id: recipientIdentityId,
        message_id: messageId,
      })})`,
    );
  } catch (err) {
    // Notification failure is non-fatal — the row is already persisted.
    // Subscribers can catch up via since on next reconnect.
    console.warn("[inbox-push] publishArrival notify failed:", (err as Error).message);
  }
}
