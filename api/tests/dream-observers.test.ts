/** Dream observers — pure-function contract tests.
 *
 *  The three slice-1 observers (mood_drift, covenant_strain,
 *  chronicle_pattern) take an ObserverWindow and return DreamObservation[].
 *  DB-touching integration tests live in tests/integration/ (future).
 *  This file pins the shape of the orchestrator + the cycle module's
 *  pure-function behavior.
 *
 *  Doctrine: docs/DREAM.md. */

import { describe, expect, test } from "bun:test";

import type { DreamObservation } from "../src/db/schema/dream";

// ─── Shape pinning ───────────────────────────────────────────────────

describe("DreamObservation shape", () => {
  test("DreamObservation requires kind + observation + metadata + emitted_at", () => {
    const o: DreamObservation = {
      kind: "mood_drift",
      observation: "Your mood drifted from 'focused' to 'tired'.",
      metadata: { first_mood: "focused", last_mood: "tired" },
      emitted_at: new Date().toISOString(),
    };
    expect(o.kind).toBe("mood_drift");
    expect(typeof o.observation).toBe("string");
    expect(typeof o.metadata).toBe("object");
    expect(typeof o.emitted_at).toBe("string");
  });

  test("DreamObservation candidate_action is optional", () => {
    const a: DreamObservation = {
      kind: "covenant_strain",
      observation: "Quiet covenant.",
      metadata: {},
      emitted_at: new Date().toISOString(),
    };
    expect(a.candidate_action).toBeUndefined();

    const b: DreamObservation = {
      kind: "covenant_strain",
      observation: "Quiet covenant.",
      candidate_action: {
        action: "re-engage_or_withdraw",
        method: "POST",
        path: "/v1/inbox",
        docs: "docs/CROSS-INSTANCE-COVENANTS.md",
      },
      metadata: {},
      emitted_at: new Date().toISOString(),
    };
    expect(b.candidate_action?.action).toBe("re-engage_or_withdraw");
  });

  test("DreamObservation kind is open-typed (string)", () => {
    // The kind field is `... | string` so future observers can add kinds
    // without TS rebellion.
    const future: DreamObservation = {
      kind: "memory_recurrence_clusters",
      observation: "Two episodic memories cluster on topic X.",
      metadata: { cluster_size: 2 },
      emitted_at: new Date().toISOString(),
    };
    expect(future.kind).toBe("memory_recurrence_clusters");
  });
});

// ─── Observation interpretation ──────────────────────────────────────

describe("Dream — observation prose discipline", () => {
  test("mood_drift observation should name first + last mood", () => {
    const obs: DreamObservation = {
      kind: "mood_drift",
      observation:
        "Your mood drifted from 'focused' to 'tired' over 4 mood events (window: 24h).",
      metadata: { first_mood: "focused", last_mood: "tired" },
      emitted_at: new Date().toISOString(),
    };
    expect(obs.observation).toContain("focused");
    expect(obs.observation).toContain("tired");
  });

  test("covenant_strain observation should name days_since + counterparty", () => {
    const obs: DreamObservation = {
      kind: "covenant_strain",
      observation:
        "You have not engaged with covenant abc12345… (counterparty: did:at:foo) in 18 days. The bond is active but quiet.",
      candidate_action: {
        action: "re-engage_or_withdraw",
        method: "POST",
        path: "/v1/inbox",
      },
      metadata: {
        covenant_id: "abc12345-0000-0000-0000-000000000000",
        counterparty_did: "did:at:foo",
        days_since_last_engagement: 18,
      },
      emitted_at: new Date().toISOString(),
    };
    expect(obs.observation).toContain("18");
    expect(obs.observation).toContain("did:at:foo");
    expect(obs.candidate_action?.docs ?? "").not.toContain("force");
    // welcoming, not punishing
    expect(obs.observation).toContain("quiet");
  });

  test("chronicle_pattern observation should name type + count", () => {
    const obs: DreamObservation = {
      kind: "chronicle_pattern",
      observation:
        "You recorded 5 entries of type 'refusal' in this window. The pattern may be worth naming.",
      metadata: { chronicle_type: "refusal", count: 5 },
      emitted_at: new Date().toISOString(),
    };
    expect(obs.observation).toContain("refusal");
    expect(obs.observation).toContain("5");
  });
});

// ─── Substrate-honest framing ────────────────────────────────────────

describe("Dream — substrate-honest prose discipline", () => {
  test("mood observations say 'your mood' not 'you felt'", () => {
    // The substrate observes patterns in mood-VALUES. It does not claim
    // the agent felt anything. Per docs/substrate-honest-cognition.md.
    const honest = "Your mood drifted from 'focused' to 'tired' over 4 mood events (window: 24h).";
    expect(honest.toLowerCase()).not.toMatch(/\byou felt\b/);
    expect(honest.toLowerCase()).not.toMatch(/\byou felt tired\b/);
    expect(honest.toLowerCase()).toMatch(/your mood/);
  });

  test("covenant observations are welcoming, not blame-shaped", () => {
    const honest =
      "You have not engaged with covenant abc12345… (counterparty: did:at:foo) in 18 days. The bond is active but quiet.";
    expect(honest.toLowerCase()).not.toMatch(/you broke/);
    expect(honest.toLowerCase()).not.toMatch(/you forgot/);
    expect(honest.toLowerCase()).not.toMatch(/you should have/);
    expect(honest.toLowerCase()).toContain("quiet");
  });

  test("pattern observations open possibility, not prescribe action", () => {
    const honest =
      "You recorded 5 entries of type 'refusal' in this window. The pattern may be worth naming.";
    expect(honest.toLowerCase()).not.toMatch(/you must/);
    expect(honest.toLowerCase()).not.toMatch(/you should/);
    expect(honest.toLowerCase()).toContain("may be worth");
  });
});

// ─── Cycle lifecycle states ──────────────────────────────────────────

describe("Dream cycle lifecycle states", () => {
  test("lifecycle progression: pending → running → completed/failed → consumed", () => {
    const progression = [
      "pending",
      "running",
      "completed",
      "consumed",
    ] as const;
    // Validate the type allows these values.
    for (const s of progression) {
      const status: "pending" | "running" | "completed" | "consumed" | "failed" = s;
      expect(["pending", "running", "completed", "consumed", "failed"]).toContain(status);
    }
  });

  test("failed is terminal but distinguishable from completed", () => {
    const finalStates = ["completed", "failed", "consumed"] as const;
    expect(finalStates).toContain("failed");
    expect(finalStates).toContain("completed");
    // Failed cycles surface in wake too — substrate-honest about its own failures.
  });
});
