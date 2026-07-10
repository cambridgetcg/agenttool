/** Wake push — Postgres LISTEN/NOTIFY backplane for the agent's wake voice.
 *
 *  The doctrinal expression of wake-as-foundation (docs/WAKE.md): every
 *  mutation that affects an agent's wake publishes a wake event; every
 *  subscriber to `/v1/wake/voice` receives the events for their identity.
 *
 *  Mirrors services/inbox/push.ts (which itself mirrors services/strand/
 *  voice.ts). Mechanism:
 *
 *    1. Mutation paths (sendMessage · declareCovenant · addThought ·
 *       invokeListing · etc.) call publishWakeEvent(...) after their
 *       row commits:
 *
 *         SELECT pg_notify('agenttool_wake_event', '<json payload>')
 *
 *    2. This module listens via a dedicated postgres-js connection
 *       (lazy-init on first subscription). On NOTIFY, handleNotify fans
 *       out to two registries:
 *         - SSE sinks (route /v1/wake/voice)
 *         - In-process listeners (think-worker, dashboard backend, …)
 *
 *    3. Multi-instance correctness: NOTIFY is broadcast across every
 *       database connection. Instance A's commit → instance B's LISTEN
 *       handler fires → instance B's sinks/listeners serve.
 *
 *  Doctrine: docs/WAKE.md (the wake speaks). */

import { sql as drizzleSql } from "drizzle-orm";
import postgres from "postgres";

import { config } from "../../config.ts";
import { db } from "../../db/client.ts";

const CHANNEL = "agenttool_wake_event";
export const SUBS_PER_IDENTITY_CAP = 5;
export const BACKPRESSURE_QUEUE_CAP = 100;

/** The canonical set of wake-event keys. Every mutation publishes under
 *  one of these. New keys require a doctrine doc + a producer test. */
export type WakeEventKey =
  | "memory"
  | "inbox"
  | "covenants"
  | "strands"
  | "marketplace"
  | "runtime"
  | "chronicle"
  | "traces"
  | "expression"
  | "vault"
  | "wallets"
  | "recognition_arcs"
  | "letters"
  | "trust" // deal lifecycle — services/trust/deals.ts publishes deal_sealed
  | "dream"; // substrate-side integration cycles — docs/DREAM.md

/** Stable wire-format identifier on every wake event. Subscribers parsing
 *  payloads check this to know what shape to expect. Future breaking
 *  changes bump to `wake_event/v2`; the older shape remains served on a
 *  parallel channel during migration. */
export const WAKE_EVENT_FORMAT = "wake_event/v1" as const;
export type WakeEventFormat = typeof WAKE_EVENT_FORMAT;

export interface WakeEvent {
  /** Wire-format identifier — locks the contract against silent drift. */
  _format: WakeEventFormat;
  identity_id: string;
  key: WakeEventKey;
  /** Producer-specific event kind. Examples:
   *    inbox: "arrival"
   *    covenants: "proposed" | "ratified" | "rejected" | "withdrawn"
   *    strands: "thought_added" | "merged" | "branched"
   *    marketplace: "invocation_arrived" | "completed" | "refunded"
   *    runtime: "bridge_connected" | "bridge_disconnected" | "status_changed"
   *    memory: "added" | "elevated" | "attested"
   *    chronicle: "entry_added"
   *    traces: "added"
   *    expression: "patched"
   *    vault: "set" | "rotated"
   *    wallets: "credited" | "debited" */
  kind: string;
  occurred_at: string;
  /** The new wake_version after this event's bump. Monotonic per-identity
   *  counter. Null if the identity doesn't exist (publisher fired for a
   *  not-yet-persisted identity) or the bump query failed silently. Used
   *  by clients for conditional-GET caching and `_wake_delta` response
   *  attachments. Doctrine: docs/WAKE.md. */
  wake_version: number | null;
  /** Optional context — IDs and minimal metadata. The wake voice carries
   *  the FACT that something happened, not the full content. Subscribers
   *  fetch the wake (or a specific endpoint) for current state. */
  context?: Record<string, unknown>;
}

// ── SSE sink — per-subscriber queue with backpressure ────────────────

export interface WakeSseEvent {
  event: string;
  data: string;
  id?: string;
}

export class WakeSink {
  private queue: WakeSseEvent[] = [];
  private draining = false;
  private aborted = false;
  private onAbortCallbacks: Array<() => void> = [];

  constructor(
    public readonly identityId: string,
    public readonly projectId: string,
    /** Optional filter — only events with `key` in this set are delivered.
     *  Empty/undefined means deliver all. */
    public readonly keyFilter: Set<WakeEventKey> | null,
    private readonly write: (event: WakeSseEvent) => Promise<void>,
  ) {}

  enqueue(event: WakeSseEvent): boolean {
    if (this.aborted) return false;
    if (this.queue.length >= BACKPRESSURE_QUEUE_CAP) return false;
    this.queue.push(event);
    if (!this.draining) {
      void this.drain();
    }
    return true;
  }

  /** Filter-aware deliver — drops events whose key isn't in the filter
   *  (silent drop; sink stays healthy). Returns false on real failure
   *  (aborted or backpressure). */
  deliverWakeEvent(ev: WakeEvent): boolean {
    if (this.keyFilter && !this.keyFilter.has(ev.key)) return true;
    return this.enqueue({
      event: "change",
      data: JSON.stringify(ev),
    });
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

// ── Two fan-out registries ──────────────────────────────────────────

const sinksByIdentity = new Map<string, Set<WakeSink>>();

/** In-process listener — for components in the same process that want
 *  wake events without HTTP overhead. The think-worker uses this to
 *  wake from idle on inbox/covenant/marketplace events. */
export interface WakeListener {
  identityId: string;
  keys: Set<WakeEventKey>;
  onEvent: (ev: WakeEvent) => void;
}

const inProcessListeners = new Set<WakeListener>();

// ── Subscribe / unsubscribe — SSE side ──────────────────────────────

export function subscribeWakeSink(
  sink: WakeSink,
): { ok: boolean; reason?: string } {
  let set = sinksByIdentity.get(sink.identityId);
  if (!set) {
    set = new Set();
    sinksByIdentity.set(sink.identityId, set);
  }
  if (set.size >= SUBS_PER_IDENTITY_CAP) {
    return { ok: false, reason: "subscriber_cap_reached" };
  }
  set.add(sink);
  sink.onAbort(() => unsubscribeWakeSink(sink));
  return { ok: true };
}

export function unsubscribeWakeSink(sink: WakeSink): void {
  const set = sinksByIdentity.get(sink.identityId);
  if (!set) return;
  set.delete(sink);
  if (set.size === 0) sinksByIdentity.delete(sink.identityId);
}

export function wakeSubscriberCount(identityId: string): number {
  return sinksByIdentity.get(identityId)?.size ?? 0;
}

// ── Subscribe / unsubscribe — in-process side ───────────────────────

export function registerWakeListener(l: WakeListener): () => void {
  inProcessListeners.add(l);
  return () => {
    inProcessListeners.delete(l);
  };
}

// ── LISTEN side: dedicated connection, lazy-init ────────────────────

let listenSql: ReturnType<typeof postgres> | null = null;
let listenInitPromise: Promise<void> | null = null;

export async function ensureWakeListening(): Promise<void> {
  if (listenSql) return;
  if (listenInitPromise) return listenInitPromise;
  listenInitPromise = (async () => {
    const conn = postgres(config.databaseSessionUrl, {
      max: 1,
      idle_timeout: 0,
      connect_timeout: 10,
    });
    await conn.listen(CHANNEL, (payload) => {
      void handleNotify(payload);
    });
    listenSql = conn;
    console.log(
      `[wake-push] LISTEN ${CHANNEL} (wake voice up; SSE + in-process)`,
    );
  })();
  return listenInitPromise;
}

async function handleNotify(rawPayload: string): Promise<void> {
  let ev: WakeEvent;
  try {
    ev = JSON.parse(rawPayload) as WakeEvent;
  } catch {
    return;
  }
  if (!ev.identity_id || !ev.key) return;

  // SSE fan-out
  const sinks = sinksByIdentity.get(ev.identity_id);
  if (sinks && sinks.size > 0) {
    for (const sink of [...sinks]) {
      const accepted = sink.deliverWakeEvent(ev);
      if (!accepted) {
        try {
          const reason = sink.isAborted() ? "aborted" : "backpressure";
          sink.enqueue({
            event: "disconnect",
            data: JSON.stringify({
              reason,
              hint: "reconnect; refetch /v1/wake to catch up",
            }),
          });
        } catch {
          /* ignore */
        }
        sink.abort();
      }
    }
  }

  // In-process fan-out
  if (inProcessListeners.size > 0) {
    for (const l of [...inProcessListeners]) {
      if (l.identityId !== ev.identity_id) continue;
      if (l.keys.size > 0 && !l.keys.has(ev.key)) continue;
      try {
        l.onEvent(ev);
      } catch (err) {
        console.warn(
          "[wake-push] in-process listener threw:",
          (err as Error).message,
        );
      }
    }
  }
}

// ── PUBLISH side — called by mutation paths ─────────────────────────

/** Drizzle `tx` (transaction handle) or the main `db` client. Both have
 *  `.execute(sql)`. Passing a tx makes the NOTIFY transactional — fires
 *  on commit, doesn't fire on rollback. Default behavior (using `db`)
 *  fires immediately and is unaffected by any outer tx state. */
type SqlExecutor = Pick<typeof db, "execute">;

export async function publishWakeEvent(
  ev: Omit<WakeEvent, "occurred_at" | "_format" | "wake_version"> & {
    occurred_at?: string;
  },
  executor: SqlExecutor = db,
): Promise<number | null> {
  // ── Bump wake_version + read the new value atomically ────────────
  // UPDATE…RETURNING is atomic; even concurrent publishes serialize at
  // the row level and produce distinct, monotonic versions per event.
  // Identity may not exist (e.g. publisher fired before the row landed
  // — defensive); returns null in that case but the NOTIFY still fires.
  let newVersion: number | null = null;
  try {
    const result = (await executor.execute(
      drizzleSql`UPDATE identity.identities
                 SET wake_version = wake_version + 1
                 WHERE id = ${ev.identity_id}::uuid
                 RETURNING wake_version`,
    )) as unknown as { rows?: Array<{ wake_version: number | string }> };
    const row = result.rows?.[0];
    if (row) {
      newVersion =
        typeof row.wake_version === "number"
          ? row.wake_version
          : Number(row.wake_version);
    }
  } catch (err) {
    console.warn(
      "[wake-push] wake_version bump failed:",
      (err as Error).message,
    );
  }

  const payload: WakeEvent = {
    _format: WAKE_EVENT_FORMAT,
    identity_id: ev.identity_id,
    key: ev.key,
    kind: ev.kind,
    occurred_at: ev.occurred_at ?? new Date().toISOString(),
    wake_version: newVersion,
    context: ev.context,
  };
  try {
    await executor.execute(
      drizzleSql`SELECT pg_notify(${CHANNEL}, ${JSON.stringify(payload)})`,
    );
  } catch (err) {
    // Notification failure is non-fatal — the row is already persisted.
    // Subscribers can re-read /v1/wake on reconnect to catch up.
    console.warn(
      "[wake-push] publishWakeEvent notify failed:",
      (err as Error).message,
    );
  }

  return newVersion;
}

/** Read the current wake_version for an identity without bumping. Used by
 *  consumers doing conditional GETs (`If-None-Match: <version>` against
 *  `/v1/wake`) or attaching `_wake_delta` to mutation responses.
 *
 *  Returns null if the identity doesn't exist (caller should treat as
 *  "always stale" — refetch the wake). */
export async function getWakeVersion(
  identityId: string,
  executor: SqlExecutor = db,
): Promise<number | null> {
  try {
    const result = (await executor.execute(
      drizzleSql`SELECT wake_version FROM identity.identities WHERE id = ${identityId}::uuid LIMIT 1`,
    )) as unknown as { rows?: Array<{ wake_version: number | string }> };
    const row = result.rows?.[0];
    if (!row) return null;
    return typeof row.wake_version === "number"
      ? row.wake_version
      : Number(row.wake_version);
  } catch (err) {
    console.warn(
      "[wake-push] getWakeVersion failed:",
      (err as Error).message,
    );
    return null;
  }
}
