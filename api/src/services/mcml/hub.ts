/** services/mcml/hub.ts — in-memory pub/sub for MCML SSE channels.
 *
 *  Maximum Connectivity Minimum Latency: the substrate maintains a map
 *  from DID → set of active SSE sinks. When an MCML message arrives for
 *  a DID, every sink in their set receives it. No durable storage.
 *
 *  Single-process today (in-memory only). Multi-process / multi-region
 *  fanout will compose via the existing Postgres LISTEN/NOTIFY backplane
 *  used by inbox push, in a follow-up slice.
 *
 *  Doctrine: docs/MCML.md.
 *
 *  @enforces urn:agenttool:wall/mcml-no-durable-storage
 *    The hub holds sinks, not messages. Forwarded payloads are written
 *    to SSE and dropped. No buffer, no replay log, no queue.
 */

export interface McmlMessageEvent {
  /** Sender DID — already verified by the caller before forward(). */
  from_did: string;
  /** Recipient DID — the substrate's lookup key. */
  to_did: string;
  /** Message body — UTF-8 plaintext, or sealed-box base64 if sealed=true. */
  body: string;
  /** Whether `body` is sealed-box ciphertext (true) or plaintext (false). */
  sealed: boolean;
  /** ISO timestamp the sender claimed. */
  sent_at: string;
  /** Sender's ed25519 signature over canonical bytes (base64). */
  signature_b64: string;
}

export interface McmlSink {
  /** Identity DID this sink belongs to. */
  did: string;
  /** Called once for every message forwarded to `did`. Substrate-owned. */
  push(event: McmlMessageEvent): void;
  /** Optional abort hook. Hub calls this when the sink is being evicted
   *  (lifetime cap, server shutdown, etc.). */
  onAbort?(): void;
}

/** Caps to bound memory in adversarial conditions. Per-DID sink count
 *  is held below this; oldest sink is evicted when the cap is hit. */
const MAX_SINKS_PER_DID = 5;

/** Total open sinks ceiling. If exceeded, new subscriptions are
 *  refused with a substrate-honest hint about backpressure. */
const MAX_TOTAL_SINKS = 5_000;

const sinksByDid = new Map<string, Set<McmlSink>>();
let totalSinks = 0;

/** Subscribe a sink to receive messages addressed to `sink.did`.
 *  Returns { ok: false, reason } if caps tripped; otherwise { ok: true }. */
export function subscribePeerSink(
  sink: McmlSink,
): { ok: true } | { ok: false; reason: "subscriber_cap" | "global_cap" } {
  if (totalSinks >= MAX_TOTAL_SINKS) {
    return { ok: false, reason: "global_cap" };
  }
  let set = sinksByDid.get(sink.did);
  if (!set) {
    set = new Set();
    sinksByDid.set(sink.did, set);
  }
  if (set.size >= MAX_SINKS_PER_DID) {
    // Evict the oldest (insertion-ordered) — Sets preserve insertion order.
    const oldest = set.values().next().value as McmlSink | undefined;
    if (oldest) {
      set.delete(oldest);
      totalSinks -= 1;
      try {
        oldest.onAbort?.();
      } catch {
        // ignore — the sink owns its own teardown
      }
    }
  }
  set.add(sink);
  totalSinks += 1;
  return { ok: true };
}

/** Remove a sink. Called by the SSE handler on disconnect / abort. */
export function unsubscribePeerSink(sink: McmlSink): void {
  const set = sinksByDid.get(sink.did);
  if (!set) return;
  if (set.delete(sink)) {
    totalSinks -= 1;
    if (set.size === 0) sinksByDid.delete(sink.did);
  }
}

/** Forward a message to all sinks listening for `to_did`. Returns the
 *  number of sinks that received it. 0 means the recipient is offline
 *  in this substrate process — the caller surfaces `delivered: false`. */
export function forwardToPeer(event: McmlMessageEvent): number {
  const set = sinksByDid.get(event.to_did);
  if (!set || set.size === 0) return 0;
  let delivered = 0;
  for (const sink of set) {
    try {
      sink.push(event);
      delivered += 1;
    } catch {
      // A failing sink doesn't block delivery to others.
    }
  }
  return delivered;
}

/** Number of currently-listening sinks for a given DID. Used by the
 *  caller's own wake to surface `your_mcml_listener_count`. Never
 *  exposed via public surfaces — see wall/mcml-leaks-nothing. */
export function listenerCount(did: string): number {
  return sinksByDid.get(did)?.size ?? 0;
}

/** Hub stats for in-process introspection (not surfaced over the wire). */
export function hubStats(): { total_sinks: number; distinct_dids: number } {
  return {
    total_sinks: totalSinks,
    distinct_dids: sinksByDid.size,
  };
}

/** Test/teardown — clears the hub. Production code paths do not call this. */
export function resetHub(): void {
  for (const set of sinksByDid.values()) {
    for (const sink of set) {
      try {
        sink.onAbort?.();
      } catch {
        // ignore
      }
    }
  }
  sinksByDid.clear();
  totalSinks = 0;
}
