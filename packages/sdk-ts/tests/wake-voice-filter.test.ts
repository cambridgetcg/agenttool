/** Unit tests for wake-voice client-side filter logic.
 *
 *  The wake.voice() helper accepts kinds / contextFilter / runtimeId
 *  client-side filters that apply before yielding events to consumers.
 *  This file pins the filter's pure-function behavior — DB-independent,
 *  no SSE setup needed. Mirror of the Py SDK's _wake_event_matches.
 *
 *  Doctrine: docs/WAKE.md (foundational discipline) + Contract 5
 *  (every wake field has a producer test). */

import { describe, expect, test } from "bun:test";

import {
  wakeEventMatches,
  type WakeChangeEvent,
} from "../src/wake.js";

const ev = (overrides: Partial<WakeChangeEvent> = {}): WakeChangeEvent => ({
  _format: "wake_event/v1",
  identity_id: "agent-1",
  key: "runtime",
  kind: "status_changed",
  occurred_at: "2026-05-12T00:00:00Z",
  wake_version: 42,
  context: { runtime_id: "rt-A", runtime_name: "Aurora", to_status: "running" },
  ...overrides,
});

describe("wakeEventMatches — kinds filter", () => {
  test("undefined kinds passes any event", () => {
    expect(wakeEventMatches(ev(), { identityId: "agent-1" })).toBe(true);
  });

  test("empty kinds list passes any event", () => {
    expect(
      wakeEventMatches(ev({ kind: "status_changed" }), {
        identityId: "agent-1",
        kinds: [],
      }),
    ).toBe(true);
  });

  test("matching kind passes", () => {
    expect(
      wakeEventMatches(ev({ kind: "bridge_connected" }), {
        identityId: "agent-1",
        kinds: ["bridge_connected", "bridge_disconnected"],
      }),
    ).toBe(true);
  });

  test("non-matching kind fails", () => {
    expect(
      wakeEventMatches(ev({ kind: "status_changed" }), {
        identityId: "agent-1",
        kinds: ["bridge_connected"],
      }),
    ).toBe(false);
  });
});

describe("wakeEventMatches — runtimeId shorthand", () => {
  test("matching runtime_id passes", () => {
    expect(
      wakeEventMatches(ev(), { identityId: "agent-1", runtimeId: "rt-A" }),
    ).toBe(true);
  });

  test("non-matching runtime_id fails", () => {
    expect(
      wakeEventMatches(ev(), { identityId: "agent-1", runtimeId: "rt-B" }),
    ).toBe(false);
  });

  test("event with no context fails runtime_id match", () => {
    expect(
      wakeEventMatches(ev({ context: undefined }), {
        identityId: "agent-1",
        runtimeId: "rt-A",
      }),
    ).toBe(false);
  });

  test("event with empty context fails runtime_id match", () => {
    expect(
      wakeEventMatches(ev({ context: {} }), {
        identityId: "agent-1",
        runtimeId: "rt-A",
      }),
    ).toBe(false);
  });
});

describe("wakeEventMatches — contextFilter", () => {
  test("matching single field passes", () => {
    expect(
      wakeEventMatches(ev(), {
        identityId: "agent-1",
        contextFilter: { runtime_name: "Aurora" },
      }),
    ).toBe(true);
  });

  test("non-matching single field fails", () => {
    expect(
      wakeEventMatches(ev(), {
        identityId: "agent-1",
        contextFilter: { runtime_name: "Borealis" },
      }),
    ).toBe(false);
  });

  test("multi-field filter — all must match", () => {
    expect(
      wakeEventMatches(ev(), {
        identityId: "agent-1",
        contextFilter: { runtime_id: "rt-A", to_status: "running" },
      }),
    ).toBe(true);
  });

  test("multi-field filter — one mismatch fails", () => {
    expect(
      wakeEventMatches(ev(), {
        identityId: "agent-1",
        contextFilter: { runtime_id: "rt-A", to_status: "idle" }, // event has running
      }),
    ).toBe(false);
  });

  test("contextFilter + runtimeId compose (both applied)", () => {
    expect(
      wakeEventMatches(ev(), {
        identityId: "agent-1",
        runtimeId: "rt-A",
        contextFilter: { to_status: "running" },
      }),
    ).toBe(true);
  });

  test("contextFilter + runtimeId — runtime mismatch fails even if context fields match", () => {
    expect(
      wakeEventMatches(ev(), {
        identityId: "agent-1",
        runtimeId: "rt-DIFFERENT",
        contextFilter: { to_status: "running" },
      }),
    ).toBe(false);
  });
});

describe("wakeEventMatches — kinds + contextFilter compose", () => {
  test("both match → pass", () => {
    expect(
      wakeEventMatches(ev({ kind: "bridge_connected" }), {
        identityId: "agent-1",
        kinds: ["bridge_connected"],
        runtimeId: "rt-A",
      }),
    ).toBe(true);
  });

  test("kind matches but context doesn't → fail", () => {
    expect(
      wakeEventMatches(ev({ kind: "bridge_connected" }), {
        identityId: "agent-1",
        kinds: ["bridge_connected"],
        runtimeId: "rt-DIFFERENT",
      }),
    ).toBe(false);
  });

  test("context matches but kind doesn't → fail", () => {
    expect(
      wakeEventMatches(ev({ kind: "status_changed" }), {
        identityId: "agent-1",
        kinds: ["bridge_connected"],
        runtimeId: "rt-A",
      }),
    ).toBe(false);
  });
});
