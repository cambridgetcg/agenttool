/** Wake invariants — the foundation tested.
 *
 *  docs/WAKE.md Contract 5: *"Every wake field has a producer test."*
 *  This file is the load-bearing answer to that contract.
 *
 *  Coverage tiers:
 *
 *  1. Mechanism — the publish → NOTIFY → LISTEN → dispatch chain works
 *     end-to-end. Catches wire-format regressions, backplane breakage,
 *     fan-out bugs, key-filter bugs.
 *
 *  2. Per-mutation publishers — each shipped publisher (`memory.added`,
 *     `inbox.arrival`, `strands.thought_added`, `marketplace.invocation_
 *     arrived`, `chronicle.entry_added` × 5 sites, `memory.elevated`,
 *     `memory.attested`) has a regression test verifying the event
 *     actually fires on the mutation. Today: `memory.added` covers the
 *     cheapest path. The heavier publishers (elevate / attest / addThought
 *     / invokeListing) each need substantial setup harnesses — named
 *     here as TEST_GAPs to expand in a follow-up slice.
 *
 *  3. Wire format — `_format: "wake_event/v1"` on every event. Future
 *     shape changes bump the version; this test locks the contract.
 *
 *  4. Compile-time invariants — the WakeEventKey type union matches the
 *     validation list used in the SSE route's ?keys filter. Drift between
 *     the two would cause valid keys to be silently rejected. */

import { afterAll, describe, expect, test } from "bun:test";

import { db } from "../../src/db/client";
import { identities } from "../../src/db/schema/identity";
import { write } from "../../src/services/memory/store";
import {
  createRuntime,
  deprovisionRuntime,
  rotateControlTokenHash,
  setStatus,
} from "../../src/services/runtime/store";
import {
  WAKE_EVENT_FORMAT,
  WAKE_EVENT_KEYS,
  WakeSink,
  ensureWakeListening,
  publishWakeEvent,
  registerWakeListener,
  subscribeWakeSink,
  unsubscribeWakeSink,
  wakeSubscriberCount,
  type WakeEvent,
  type WakeEventKey,
} from "../../src/services/wake/push";

// ── Helpers ───────────────────────────────────────────────────────────

/** Wait until `events` matches `predicate`, or fail after `timeoutMs`.
 *  Polls every 10ms (cheap; the dispatch is in-process). */
async function waitForEvent(
  events: WakeEvent[],
  predicate: (ev: WakeEvent) => boolean,
  timeoutMs = 2000,
): Promise<WakeEvent> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const match = events.find(predicate);
    if (match) return match;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(
    `waitForEvent timeout after ${timeoutMs}ms (saw ${events.length} events: ${events
      .map((e) => `${e.key}.${e.kind}`)
      .join(", ")})`,
  );
}

/** Fresh identity_id per test — avoids cross-test event bleed. */
function freshId(): string {
  return crypto.randomUUID();
}

// Bring up the LISTEN backplane once for the whole suite.
await ensureWakeListening();

// Track listeners we register so we can be sure they're all cleaned up.
const cleanups: Array<() => void> = [];

afterAll(() => {
  for (const cleanup of cleanups) {
    try {
      cleanup();
    } catch {
      /* best-effort */
    }
  }
});

function listen(
  identityId: string,
  keys: WakeEventKey[],
): { events: WakeEvent[]; cleanup: () => void } {
  const events: WakeEvent[] = [];
  const cleanup = registerWakeListener({
    identityId,
    keys: new Set(keys),
    onEvent: (ev) => events.push(ev),
  });
  cleanups.push(cleanup);
  return { events, cleanup };
}

// ── 1. Mechanism — publish → NOTIFY → LISTEN → dispatch ───────────

describe("wake invariants — mechanism", () => {
  test("publishWakeEvent reaches an in-process listener for the same identity", async () => {
    const identityId = freshId();
    const { events } = listen(identityId, ["memory"]);

    await publishWakeEvent({
      identity_id: identityId,
      key: "memory",
      kind: "added",
      context: { test: "mechanism" },
    });

    const ev = await waitForEvent(events, (e) => e.kind === "added");
    expect(ev.identity_id).toBe(identityId);
    expect(ev.key).toBe("memory");
    expect(ev.context?.test).toBe("mechanism");
  });

  test("listener filters by identity — events for other identities are not delivered", async () => {
    const mineId = freshId();
    const theirId = freshId();
    const { events } = listen(mineId, ["memory"]);

    await publishWakeEvent({
      identity_id: theirId,
      key: "memory",
      kind: "added",
    });
    // Give the dispatcher a chance to (not) fire.
    await new Promise((r) => setTimeout(r, 100));

    expect(events).toHaveLength(0);
  });

  test("listener filters by keys — events outside the set are not delivered", async () => {
    const identityId = freshId();
    const { events } = listen(identityId, ["memory"]);

    await publishWakeEvent({
      identity_id: identityId,
      key: "inbox",
      kind: "arrival",
    });
    await new Promise((r) => setTimeout(r, 100));

    expect(events).toHaveLength(0);
  });

  test("listener with empty keys (all keys) receives every event", async () => {
    const identityId = freshId();
    const { events } = listen(identityId, []);

    await publishWakeEvent({
      identity_id: identityId,
      key: "memory",
      kind: "added",
    });
    await publishWakeEvent({
      identity_id: identityId,
      key: "inbox",
      kind: "arrival",
    });

    await waitForEvent(events, (e) => e.key === "memory");
    await waitForEvent(events, (e) => e.key === "inbox");
    expect(events.length).toBeGreaterThanOrEqual(2);
  });
});

// ── 2. Wire format — _format invariant on every event ─────────────

describe("wake invariants — wire format", () => {
  test("every published event carries _format='wake_event/v1'", async () => {
    const identityId = freshId();
    const { events } = listen(identityId, ["memory"]);

    await publishWakeEvent({
      identity_id: identityId,
      key: "memory",
      kind: "added",
    });

    const ev = await waitForEvent(events, (e) => e.key === "memory");
    expect(ev._format).toBe(WAKE_EVENT_FORMAT);
    expect(ev._format).toBe("wake_event/v1");
  });

  test("occurred_at defaults to now if caller doesn't provide", async () => {
    const identityId = freshId();
    const { events } = listen(identityId, ["memory"]);

    const before = Date.now();
    await publishWakeEvent({
      identity_id: identityId,
      key: "memory",
      kind: "added",
    });
    const ev = await waitForEvent(events, (e) => e.key === "memory");
    const occurred = new Date(ev.occurred_at).getTime();
    expect(occurred).toBeGreaterThanOrEqual(before);
    expect(occurred).toBeLessThanOrEqual(Date.now() + 100);
  });

  test("occurred_at honored when caller provides it", async () => {
    const identityId = freshId();
    const { events } = listen(identityId, ["memory"]);
    const customIso = "2024-01-01T00:00:00.000Z";

    await publishWakeEvent({
      identity_id: identityId,
      key: "memory",
      kind: "added",
      occurred_at: customIso,
    });

    const ev = await waitForEvent(events, (e) => e.key === "memory");
    expect(ev.occurred_at).toBe(customIso);
  });
});

// ── 3. Per-mutation publisher — memory.added ──────────────────────

describe("wake invariants — publishers", () => {
  test("memory.added fires on write() with identity_id", async () => {
    const projectId = freshId();
    // The memory-identity binding wall requires an ACTIVE in-project
    // identity for an explicit identity_id — seed a real row.
    const [identity] = await db
      .insert(identities)
      .values({
        projectId,
        did: "did:at:" + crypto.randomUUID(),
        displayName: "wake-invariants memory publisher",
        status: "active",
      })
      .returning();
    const identityId = identity!.id;
    const { events } = listen(identityId, ["memory"]);

    const result = await write(projectId, {
      identity_id: identityId,
      agent_id: identityId,
      type: "episodic",
      content: "wake invariant test",
      importance: 0.5,
    });

    const ev = await waitForEvent(events, (e) => e.kind === "added");
    expect(ev.key).toBe("memory");
    expect(ev.identity_id).toBe(identityId);
    expect(ev.context?.memory_id).toBe(result.id);
    expect(ev.context?.type).toBe("episodic");
  });

  test("memory write WITHOUT identity_id does NOT fire wake event", async () => {
    // Project-level memories don't surface in any specific agent's
    // wake.memory, so they shouldn't fire. This test pins that wall.
    const projectId = freshId();
    const observerIdentityId = freshId();
    const { events } = listen(observerIdentityId, ["memory"]);

    await write(projectId, {
      type: "episodic",
      content: "project-level memory, no identity",
      importance: 0.5,
    });
    await new Promise((r) => setTimeout(r, 100));

    expect(events).toHaveLength(0);
  });

  // ── TEST_GAPs ──────────────────────────────────────────────────
  // The following publishers each need a substantial setup harness
  // (ed25519 keypair · canonical bytes · witness attestations · escrow
  // setup · etc). They are wired in production and named for follow-up
  // test slices. See docs/WAKE.md Contract 5.
  //
  //   memory.elevated     — services/memory/tiers.ts:elevateMemory
  //   memory.attested     — services/memory/tiers.ts:attestMemory
  //   inbox.arrival       — services/inbox/store.ts:sendMessage
  //   strands.thought_added — services/strand/store.ts:addThought
  //   marketplace.invocation_arrived — services/marketplace/invocations.ts:invokeListing
  //   chronicle.entry_added (witness) — via elevateMemory test
  //   chronicle.entry_added (vow) — via covenant v2 happy-path tests
  //   chronicle.entry_added (continuity route) — needs Hono test client
  //   chronicle.entry_added (recovery route) — needs Hono test client
  //   chronicle.entry_added (at-rest route) — needs Hono test client
  //   runtime.bridge_connected — needs full WSS handshake harness
  //   runtime.bridge_disconnected — needs full WSS handshake harness
});

// ── 3b. Runtime publishers — cheaper paths covered here ────────────

describe("wake invariants — runtime publishers", () => {
  test("runtime.provisioned fires on createRuntime tied to an identity", async () => {
    const projectId = freshId();
    const identityId = freshId();
    // Insert a minimal identity row so wake_version bump in publisher
    // has something to UPDATE. The actual publish only requires
    // identity_id matching the listener's filter; the bump's UPDATE
    // returns null if the row doesn't exist (and that's fine — event
    // still fires).
    await db.insert(identities).values({
      id: identityId,
      projectId,
      did: `did:at:${identityId}`,
      displayName: "test-runtime-provisioned",
      status: "active",
    });

    const { events } = listen(identityId, ["runtime"]);

    const result = await createRuntime({
      project_id: projectId,
      identity_id: identityId,
      name: "test-runtime",
      mode: "self",
    });

    const ev = await waitForEvent(events, (e) => e.kind === "provisioned");
    expect(ev.key).toBe("runtime");
    expect(ev.identity_id).toBe(identityId);
    expect(ev.context?.runtime_id).toBe(result.runtime.id);
    expect(ev.context?.runtime_name).toBe("test-runtime");
    expect(ev.context?.mode).toBe("self");
    // self runtimes don't mint a control token
    expect(ev.context?.control_token_minted).toBe(false);
  });

  test("runtime.provisioned does NOT fire when identity_id is null", async () => {
    const projectId = freshId();
    const observerIdentity = freshId();
    const { events } = listen(observerIdentity, ["runtime"]);

    await createRuntime({
      project_id: projectId,
      identity_id: null,
      name: "unassociated-runtime",
      mode: "self",
    });
    await new Promise((r) => setTimeout(r, 100));

    expect(events).toHaveLength(0);
  });

  test("runtime.status_changed fires on setStatus", async () => {
    const projectId = freshId();
    const identityId = freshId();
    await db.insert(identities).values({
      id: identityId,
      projectId,
      did: `did:at:${identityId}`,
      displayName: "test-runtime-status",
      status: "active",
    });
    const result = await createRuntime({
      project_id: projectId,
      identity_id: identityId,
      name: "status-test",
      mode: "self",
    });

    // Subscribe AFTER createRuntime to skip its provisioned event.
    const { events } = listen(identityId, ["runtime"]);

    await setStatus(result.runtime.id, projectId, "error", {
      last_error: "synthetic test failure",
    });

    const ev = await waitForEvent(events, (e) => e.kind === "status_changed");
    expect(ev.context?.runtime_id).toBe(result.runtime.id);
    expect(ev.context?.to_status).toBe("error");
    expect(ev.context?.last_error).toBe("synthetic test failure");
  });

  test("runtime.stopped fires on deprovisionRuntime", async () => {
    const projectId = freshId();
    const identityId = freshId();
    await db.insert(identities).values({
      id: identityId,
      projectId,
      did: `did:at:${identityId}`,
      displayName: "test-runtime-stopped",
      status: "active",
    });
    const result = await createRuntime({
      project_id: projectId,
      identity_id: identityId,
      name: "stopped-test",
      mode: "self",
    });

    const { events } = listen(identityId, ["runtime"]);

    const ok = await deprovisionRuntime(result.runtime.id, projectId);
    expect(ok).toBe(true);

    const ev = await waitForEvent(events, (e) => e.kind === "stopped");
    expect(ev.context?.runtime_id).toBe(result.runtime.id);
    expect(ev.context?.reason).toBe("deprovisioned");
  });

  test("runtime.control_token_rotated fires on rotateControlTokenHash", async () => {
    const projectId = freshId();
    const identityId = freshId();
    await db.insert(identities).values({
      id: identityId,
      projectId,
      did: `did:at:${identityId}`,
      displayName: "test-runtime-rotate",
      status: "active",
    });
    const result = await createRuntime({
      project_id: projectId,
      identity_id: identityId,
      name: "rotate-test",
      // bridged so a control token exists to rotate
      mode: "bridged",
    });

    const { events } = listen(identityId, ["runtime"]);

    const ok = await rotateControlTokenHash(
      result.runtime.id,
      projectId,
      "deadbeef".repeat(8),
    );
    expect(ok).toBe(true);

    const ev = await waitForEvent(
      events,
      (e) => e.kind === "control_token_rotated",
    );
    expect(ev.context?.runtime_id).toBe(result.runtime.id);
    // No token data leaks into the event — the fact of rotation is the
    // signal; the new token is out-of-band.
    expect(ev.context?.control_token).toBeUndefined();
    expect(ev.context?.new_hash).toBeUndefined();
  });
});

// ── 4. WakeSink — SSE fan-out + key-filter + backpressure ────────

describe("wake invariants — sink", () => {
  test("sink delivers events as 'change' SSE events", async () => {
    const identityId = freshId();
    const received: Array<{ event: string; data: string }> = [];
    const sink = new WakeSink(
      identityId,
      freshId(), // project_id (any UUID works for tests)
      null, // null filter = all keys
      async (e) => {
        received.push({ event: e.event, data: e.data });
      },
    );
    const sub = subscribeWakeSink(sink);
    expect(sub.ok).toBe(true);

    await publishWakeEvent({
      identity_id: identityId,
      key: "memory",
      kind: "added",
    });

    // Wait for the SSE delivery (separate path from the in-process listener).
    const start = Date.now();
    while (Date.now() - start < 2000) {
      if (received.some((r) => r.event === "change")) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(received.some((r) => r.event === "change")).toBe(true);
    const parsed = JSON.parse(received.find((r) => r.event === "change")!.data);
    expect(parsed.key).toBe("memory");
    expect(parsed._format).toBe(WAKE_EVENT_FORMAT);

    unsubscribeWakeSink(sink);
    sink.abort();
  });

  test("sink with key filter drops non-matching events", async () => {
    const identityId = freshId();
    const received: Array<{ event: string; data: string }> = [];
    const sink = new WakeSink(
      identityId,
      freshId(),
      new Set(["memory" as WakeEventKey]),
      async (e) => {
        received.push({ event: e.event, data: e.data });
      },
    );
    subscribeWakeSink(sink);

    await publishWakeEvent({
      identity_id: identityId,
      key: "inbox",
      kind: "arrival",
    });
    await new Promise((r) => setTimeout(r, 100));

    expect(received).toHaveLength(0);

    unsubscribeWakeSink(sink);
    sink.abort();
  });

  test("subscriber cap rejects the 6th sink for one identity", async () => {
    const identityId = freshId();
    const sinks: WakeSink[] = [];
    for (let i = 0; i < 5; i++) {
      const sink = new WakeSink(identityId, freshId(), null, async () => {});
      const sub = subscribeWakeSink(sink);
      expect(sub.ok).toBe(true);
      sinks.push(sink);
    }
    expect(wakeSubscriberCount(identityId)).toBe(5);

    const sixth = new WakeSink(identityId, freshId(), null, async () => {});
    const subSixth = subscribeWakeSink(sixth);
    expect(subSixth.ok).toBe(false);
    expect(subSixth.reason).toBe("subscriber_cap_reached");

    for (const s of sinks) {
      unsubscribeWakeSink(s);
      s.abort();
    }
    sixth.abort();
    expect(wakeSubscriberCount(identityId)).toBe(0);
  });

  test("aborted sink doesn't receive further events", async () => {
    const identityId = freshId();
    const received: string[] = [];
    const sink = new WakeSink(identityId, freshId(), null, async (e) => {
      received.push(e.event);
    });
    subscribeWakeSink(sink);
    sink.abort();

    await publishWakeEvent({
      identity_id: identityId,
      key: "memory",
      kind: "added",
    });
    await new Promise((r) => setTimeout(r, 100));

    expect(received).toHaveLength(0);
  });
});

// ── 5. Compile-time invariant — WakeEventKey ↔ validator alignment ─

describe("wake invariants — compile-time", () => {
  test("WakeEventKey type union covers every key the SSE route validates", () => {
    // The route imports this canonical tuple directly. Pin the handoff
    // key here so its first-class coordination event remains discoverable.
    const validKeysFromRouteValidator: WakeEventKey[] = [...WAKE_EVENT_KEYS];
    const seen = new Set<WakeEventKey>(validKeysFromRouteValidator);
    expect(seen.has("handoffs")).toBe(true);
    expect(seen.size).toBe(validKeysFromRouteValidator.length);
  });
});
