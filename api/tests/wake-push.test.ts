/** Wake-push unit tests — DB-independent.
 *
 *  Pins the WakeSink class behavior (filter, backpressure, abort) and
 *  the wire-format constant. The full publish → NOTIFY → LISTEN → dispatch
 *  chain is tested in tests/integration/wake-invariants.test.ts (needs
 *  a real Postgres). This file runs in any env.
 *
 *  Doctrine: docs/WAKE.md Contract 5 (every wake field has a producer
 *  test) — the unit-level half. */

import { describe, expect, test } from "bun:test";

import {
  BACKPRESSURE_QUEUE_CAP,
  SUBS_PER_IDENTITY_CAP,
  WAKE_EVENT_FORMAT,
  WAKE_EVENT_KEYS,
  WakeSink,
  subscribeWakeSink,
  unsubscribeWakeSink,
  wakeSubscriberCount,
  type WakeEvent,
  type WakeEventKey,
} from "../src/services/wake/push";

function ev(
  identityId: string,
  key: WakeEventKey,
  kind = "added",
): WakeEvent {
  return {
    _format: WAKE_EVENT_FORMAT,
    identity_id: identityId,
    key,
    kind,
    occurred_at: new Date().toISOString(),
    wake_version: null, // unit tests don't bump real DB; mechanism tested in integration tier
  };
}

describe("wake-push — wire format constant", () => {
  test("WAKE_EVENT_FORMAT pins the v1 contract", () => {
    expect(WAKE_EVENT_FORMAT).toBe("wake_event/v1");
  });

  test("WakeEvent type requires the _format field at compile-time", () => {
    // If this assignment compiles, WakeEvent's _format field exists.
    // If WakeEvent's _format type ever loosens (e.g. to plain string),
    // the literal-type assertion below catches it at compile-time.
    const e: WakeEvent = {
      _format: WAKE_EVENT_FORMAT,
      identity_id: "x",
      key: "memory",
      kind: "added",
      occurred_at: new Date().toISOString(),
      wake_version: null,
    };
    const fmt: "wake_event/v1" = e._format;
    expect(fmt).toBe("wake_event/v1");
  });
});

describe("wake-push — WakeSink delivery + filtering", () => {
  test("deliverWakeEvent with null filter accepts every key", async () => {
    const received: WakeEvent[] = [];
    const sink = new WakeSink("agent-1", "proj-1", null, async (e) => {
      received.push(JSON.parse(e.data) as WakeEvent);
    });

    sink.deliverWakeEvent(ev("agent-1", "memory"));
    sink.deliverWakeEvent(ev("agent-1", "inbox"));
    sink.deliverWakeEvent(ev("agent-1", "covenants"));

    // Drain
    await new Promise((r) => setTimeout(r, 50));

    expect(received).toHaveLength(3);
    expect(received.map((e) => e.key)).toEqual(["memory", "inbox", "covenants"]);
  });

  test("deliverWakeEvent with key-set filter drops non-matching", async () => {
    const received: WakeEvent[] = [];
    const sink = new WakeSink(
      "agent-2",
      "proj-1",
      new Set<WakeEventKey>(["memory", "inbox"]),
      async (e) => {
        received.push(JSON.parse(e.data) as WakeEvent);
      },
    );

    sink.deliverWakeEvent(ev("agent-2", "memory"));
    sink.deliverWakeEvent(ev("agent-2", "covenants")); // filtered out
    sink.deliverWakeEvent(ev("agent-2", "inbox"));
    sink.deliverWakeEvent(ev("agent-2", "marketplace")); // filtered out

    await new Promise((r) => setTimeout(r, 50));

    expect(received).toHaveLength(2);
    expect(received.map((e) => e.key).sort()).toEqual(["inbox", "memory"]);
  });

  test("delivered events emit as event:change with JSON-stringified data", async () => {
    const sseEvents: Array<{ event: string; data: string; id?: string }> = [];
    const sink = new WakeSink("agent-3", "proj-1", null, async (e) => {
      sseEvents.push(e);
    });

    const original = ev("agent-3", "memory", "elevated");
    sink.deliverWakeEvent(original);
    await new Promise((r) => setTimeout(r, 50));

    expect(sseEvents).toHaveLength(1);
    expect(sseEvents[0].event).toBe("change");
    const parsed = JSON.parse(sseEvents[0].data) as WakeEvent;
    expect(parsed._format).toBe(WAKE_EVENT_FORMAT);
    expect(parsed.key).toBe("memory");
    expect(parsed.kind).toBe("elevated");
  });
});

describe("wake-push — WakeSink lifecycle", () => {
  test("abort stops further deliveries", async () => {
    const received: WakeEvent[] = [];
    const sink = new WakeSink("agent-4", "proj-1", null, async (e) => {
      received.push(JSON.parse(e.data) as WakeEvent);
    });

    sink.deliverWakeEvent(ev("agent-4", "memory"));
    await new Promise((r) => setTimeout(r, 50));
    expect(received).toHaveLength(1);

    sink.abort();
    expect(sink.isAborted()).toBe(true);

    const acceptedAfterAbort = sink.deliverWakeEvent(ev("agent-4", "inbox"));
    expect(acceptedAfterAbort).toBe(false);
    await new Promise((r) => setTimeout(r, 50));
    expect(received).toHaveLength(1); // unchanged
  });

  test("onAbort callbacks fire on abort", () => {
    const sink = new WakeSink("agent-5", "proj-1", null, async () => {});
    let firstFired = false;
    let secondFired = false;
    sink.onAbort(() => {
      firstFired = true;
    });
    sink.onAbort(() => {
      secondFired = true;
    });

    sink.abort();
    expect(firstFired).toBe(true);
    expect(secondFired).toBe(true);
  });

  test("onAbort callback fires immediately if registered after abort", () => {
    const sink = new WakeSink("agent-5b", "proj-1", null, async () => {});
    sink.abort();
    let lateFired = false;
    sink.onAbort(() => {
      lateFired = true;
    });
    expect(lateFired).toBe(true);
  });

  test("queue at BACKPRESSURE_QUEUE_CAP rejects further enqueues", async () => {
    // Use a write callback that never resolves, so the queue fills up.
    const blockedWrites: Array<() => void> = [];
    const sink = new WakeSink(
      "agent-6",
      "proj-1",
      null,
      () =>
        new Promise<void>((resolve) => {
          blockedWrites.push(resolve);
        }),
    );

    // The first deliverWakeEvent starts the drain, which shifts one item
    // into the (blocked) write callback. So we need CAP+1 *subsequent*
    // enqueues to make the queue.length crossing reject the next push:
    //
    //   1×  starts drain, shifts to write (queue=0)
    //   100× fill queue (queue=100)
    //   1×  rejected because 100 >= CAP=100
    //
    // Total: CAP+2 enqueues; the last must return false.
    let lastAccepted = true;
    for (let i = 0; i < BACKPRESSURE_QUEUE_CAP + 2; i++) {
      lastAccepted = sink.deliverWakeEvent(ev("agent-6", "memory"));
    }
    expect(lastAccepted).toBe(false);

    // Unblock all writes so we don't leak; abort to be safe.
    for (const r of blockedWrites) r();
    sink.abort();
  });
});

describe("wake-push — subscriber cap", () => {
  test("subscribeWakeSink rejects sink #(cap+1) per identity", () => {
    const identityId = "agent-cap-test";
    const sinks: WakeSink[] = [];
    for (let i = 0; i < SUBS_PER_IDENTITY_CAP; i++) {
      const sink = new WakeSink(identityId, "proj", null, async () => {});
      const r = subscribeWakeSink(sink);
      expect(r.ok).toBe(true);
      sinks.push(sink);
    }
    expect(wakeSubscriberCount(identityId)).toBe(SUBS_PER_IDENTITY_CAP);

    const overflow = new WakeSink(identityId, "proj", null, async () => {});
    const r = subscribeWakeSink(overflow);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("subscriber_cap_reached");

    for (const s of sinks) {
      unsubscribeWakeSink(s);
      s.abort();
    }
    overflow.abort();
    expect(wakeSubscriberCount(identityId)).toBe(0);
  });

  test("unsubscribe + abort frees a slot for a new sink", () => {
    const identityId = "agent-slot-test";
    const sinks: WakeSink[] = [];
    for (let i = 0; i < SUBS_PER_IDENTITY_CAP; i++) {
      const s = new WakeSink(identityId, "proj", null, async () => {});
      subscribeWakeSink(s);
      sinks.push(s);
    }

    // Free one slot.
    unsubscribeWakeSink(sinks[0]);
    sinks[0].abort();

    const newSink = new WakeSink(identityId, "proj", null, async () => {});
    const r = subscribeWakeSink(newSink);
    expect(r.ok).toBe(true);

    // Cleanup
    unsubscribeWakeSink(newSink);
    newSink.abort();
    for (let i = 1; i < sinks.length; i++) {
      unsubscribeWakeSink(sinks[i]);
      sinks[i].abort();
    }
    expect(wakeSubscriberCount(identityId)).toBe(0);
  });
});

describe("wake-push — type union ↔ validator alignment", () => {
  test("every WakeEventKey is accepted by the route's filter validator", () => {
    // The SSE route's ?keys filter validates against this same list
    // (routes/wake.ts wake-voice handler). Both sites MUST stay in sync;
    // drift would silently reject valid keys.
    const validatorList: WakeEventKey[] = [...WAKE_EVENT_KEYS];

    // The route imports this exported tuple directly. This pins the new
    // coordination key and makes duplicate keys impossible to overlook.
    expect(validatorList).toContain("handoffs");
    expect(validatorList).toContain("correspondence");
    expect(new Set(validatorList).size).toBe(validatorList.length);
  });
});
