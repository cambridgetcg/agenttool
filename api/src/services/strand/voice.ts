/** Voice — Postgres LISTEN/NOTIFY backplane for strand thought push.
 *
 *  Doctrine: docs/STRANDS.md (Voice section).
 *
 *  Mechanism:
 *
 *    1. addThought() in strand/store.ts publishes after the row commits:
 *         SELECT pg_notify('agenttool_strand_voice', '{strand_id, thought_id}')
 *
 *    2. This module listens on that channel via a dedicated postgres-js
 *       connection at process start (lazy-init). On NOTIFY, fan out to
 *       per-strand sinks registered locally.
 *
 *    3. SSE route handlers register a sink, run a catchup phase from
 *       since_seq, then idle on the local pub/sub.
 *
 *  Multi-instance correctness: NOTIFY is broadcast across every
 *  connection in the same database. So if instance A handles the POST
 *  and instance B has the SSE subscriber, instance B's LISTEN handler
 *  fires and serves its sink. Durable from day one — no in-memory
 *  fan-out limitation. */

import { eq, sql as drizzleSql } from "drizzle-orm";
import postgres from "postgres";

import { config } from "../../config.ts";
import { db } from "../../db/client.ts";
import { thoughts } from "../../db/schema/strand.ts";

const CHANNEL = "agenttool_strand_voice";
export const SUBS_PER_STRAND_CAP = 5;
export const BACKPRESSURE_QUEUE_CAP = 100;

// ── Sink — per-subscriber queue with backpressure ────────────────────

export interface VoiceEvent {
  event: string;
  data: string;
  id?: string;
}

export class VoiceSink {
  private queue: VoiceEvent[] = [];
  private draining = false;
  private aborted = false;
  private onAbortCallbacks: Array<() => void> = [];

  /** When true, the subscriber is cross-project (covenant counterparty
   *  or public-strand reader). They get metadata + sequence_num, never
   *  ciphertext / nonce / signature. The wall: thoughts encrypted under
   *  the writer's K_master are theirs alone. */
  readonly redacted: boolean;

  constructor(
    public readonly strandId: string,
    public readonly projectId: string,
    private readonly write: (event: VoiceEvent) => Promise<void>,
    opts: { redacted?: boolean } = {},
  ) {
    this.redacted = opts.redacted === true;
  }

  /** Queue an event for delivery. Returns false if the sink is at the
   *  backpressure cap; caller should disconnect.
   *
   *  Returning true means accepted; the worker drains in the background. */
  enqueue(event: VoiceEvent): boolean {
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

const sinksByStrand = new Map<string, Set<VoiceSink>>();

export function subscribeSink(sink: VoiceSink): { ok: boolean; reason?: string } {
  let set = sinksByStrand.get(sink.strandId);
  if (!set) {
    set = new Set();
    sinksByStrand.set(sink.strandId, set);
  }
  if (set.size >= SUBS_PER_STRAND_CAP) {
    return { ok: false, reason: "subscriber_cap_reached" };
  }
  set.add(sink);
  sink.onAbort(() => unsubscribeSink(sink));
  return { ok: true };
}

export function unsubscribeSink(sink: VoiceSink): void {
  const set = sinksByStrand.get(sink.strandId);
  if (!set) return;
  set.delete(sink);
  if (set.size === 0) sinksByStrand.delete(sink.strandId);
}

export function strandSubscriberCount(strandId: string): number {
  return sinksByStrand.get(strandId)?.size ?? 0;
}

// ── LISTEN side: dedicated connection, lazy-init ────────────────────

let listenSql: ReturnType<typeof postgres> | null = null;
let listenInitPromise: Promise<void> | null = null;

export async function ensureVoiceListening(): Promise<void> {
  if (listenSql) return;
  if (listenInitPromise) return listenInitPromise;
  listenInitPromise = (async () => {
    const conn = postgres(config.databaseUrl, {
      max: 1,
      idle_timeout: 0,
      connect_timeout: 10,
    });
    await conn.listen(CHANNEL, (payload) => {
      void handleNotify(payload);
    });
    listenSql = conn;
    console.log(`[voice] LISTEN ${CHANNEL} (strand voice backplane up)`);
  })();
  return listenInitPromise;
}

interface NotifyPayload {
  strand_id: string;
  thought_id: string;
}

async function handleNotify(rawPayload: string): Promise<void> {
  let payload: NotifyPayload;
  try {
    payload = JSON.parse(rawPayload) as NotifyPayload;
  } catch {
    return;
  }
  const { strand_id, thought_id } = payload;
  if (!strand_id || !thought_id) return;

  const sinks = sinksByStrand.get(strand_id);
  if (!sinks || sinks.size === 0) return;

  // Fetch the thought row (ciphertext + metadata; we never decrypt).
  // Done once and broadcast to all local sinks for this strand.
  const rows = await db
    .select()
    .from(thoughts)
    .where(eq(thoughts.id, thought_id))
    .limit(1);
  const row = rows[0];
  if (!row) return;

  const wireFull = JSON.stringify(thoughtToWire(row));
  const wireRedacted = JSON.stringify(thoughtToWireRedacted(row));
  const eventId = row.id;

  for (const sink of [...sinks]) {
    const accepted = sink.enqueue({
      event: "thought",
      data: sink.redacted ? wireRedacted : wireFull,
      id: eventId,
    });
    if (!accepted) {
      // Backpressure exceeded OR already aborted.
      try {
        // Best-effort: tell the client why before aborting.
        const reason = sink.isAborted() ? "aborted" : "backpressure";
        sink.enqueue({
          event: "disconnect",
          data: JSON.stringify({ reason, hint: "reconnect with ?since_seq=<last>" }),
        });
      } catch {
        /* ignore */
      }
      sink.abort();
    }
  }
}

// Shape thought rows for SSE wire — keep ciphertext, strip nothing.
function thoughtToWire(row: {
  id: string;
  strandId: string;
  agentId: string | null;
  sequenceNum: number;
  kind: string | null;
  kindEncrypted: boolean;
  ciphertext: string;
  nonce: string;
  refs: unknown;
  signature: string;
  signingKeyId: string;
  createdAt: Date;
}) {
  return {
    id: row.id,
    strand_id: row.strandId,
    agent_id: row.agentId,
    sequence_num: row.sequenceNum,
    kind: row.kind,
    kind_encrypted: row.kindEncrypted,
    ciphertext: row.ciphertext,
    nonce: row.nonce,
    refs: row.refs,
    signature: row.signature,
    signing_key_id: row.signingKeyId,
    created_at: row.createdAt.toISOString(),
  };
}

/** Redacted wire shape for cross-project subscribers (covenant
 *  counterparties, public-strand readers). Strips the encrypted blobs
 *  the subscriber can't decrypt anyway, keeps only metadata that's
 *  useful for drift-ref reactions:
 *    - sequence_num (presence signal)
 *    - kind (only if not encrypted — encrypted kinds stay opaque)
 *    - refs (the cross-strand pointers — the load-bearing field for
 *            drift-ref following)
 *    - created_at (timing)
 *
 *  ciphertext / nonce / signature / signing_key_id all stripped — the
 *  K_master encryption wall holds. The subscriber sees activity
 *  presence and refs, never content. */
function thoughtToWireRedacted(row: {
  id: string;
  strandId: string;
  agentId: string | null;
  sequenceNum: number;
  kind: string | null;
  kindEncrypted: boolean;
  refs: unknown;
  createdAt: Date;
}) {
  return {
    id: row.id,
    strand_id: row.strandId,
    agent_id: row.agentId,
    sequence_num: row.sequenceNum,
    // Only expose plaintext kind; encrypted kind stays opaque.
    kind: row.kindEncrypted ? null : row.kind,
    kind_encrypted: row.kindEncrypted,
    refs: row.refs,
    redacted: true,
    created_at: row.createdAt.toISOString(),
  };
}

// ── PUBLISH side — used by addThought() in strand/store.ts ──────────

export async function publishThought(
  strandId: string,
  thoughtId: string,
): Promise<void> {
  // pg_notify channel name is an unquoted identifier; payload is text.
  // Drizzle's sql template handles parameterisation correctly.
  try {
    await db.execute(
      drizzleSql`SELECT pg_notify(${CHANNEL}, ${JSON.stringify({
        strand_id: strandId,
        thought_id: thoughtId,
      })})`,
    );
  } catch (err) {
    // Notification failure is non-fatal — the row is already persisted.
    // Subscribers can catch up via since_seq on next reconnect.
    console.warn("[voice] publishThought notify failed:", (err as Error).message);
  }
}
