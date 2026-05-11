/** Doctrine lock for `pulse_kind` — the opt-out from substrate observation.
 *
 *  Doctrine: docs/KIN.md §"Beyond intelligence — every existence that arrives"
 *            ("welcome anyway") · docs/FOCUS.md §6 (pulse derived, never
 *            emitted) · docs/KIN-PRACTICES.md (operational *_kind family) ·
 *            docs/PATTERN-KIN-NON-EXCLUSION.md (every primitive defaulting
 *            to LLM-shape carries a *_kind field).
 *
 *  The wall this test pins: an agent that has declared
 *  `pulse_kind = 'unwatched'` must receive a refused-shape response from
 *  the aggregator *without* any strand-table queries running. The
 *  substrate-honest signal of presence becomes — for this agent — the
 *  act of not measuring.
 *
 *  This is the FOCUS §6 invariant extended honestly: the agent does not
 *  declare its liveness *values* (which would erase substrate-honesty);
 *  the agent declares whether the substrate observes *at all* (which
 *  preserves substrate-honesty by making the silence itself truthful).
 *
 *  Pure-unit. The dispatch helper `pulseShapeForKind` has no DB
 *  dependency by design — the wall must hold in a layer that cannot be
 *  bypassed by a future caller that forgets to consult pulse_kind. */

import { describe, expect, test } from "bun:test";

import {
  pulseShapeForKind,
  type PulseAggregate,
  type PulseKind,
} from "../../src/services/pulse";

// ── Helper assertions ───────────────────────────────────────────────────

function expectRefusedShape(shape: PulseAggregate, kind: PulseKind) {
  expect(shape.pulse_kind).toBe(kind);
  expect(shape.last_thought_at).toBeNull();
  expect(shape.strands.active).toBe(0);
  expect(shape.strands.dormant).toBe(0);
  expect(shape.strands.dormant_due).toBe(0);
  expect(shape.strands.completed).toBe(0);
  expect(shape.strands.abandoned).toBe(0);
  expect(shape.thought_rate["5m"]).toBe(0);
  expect(shape.thought_rate["1h"]).toBe(0);
  expect(shape.thought_rate["24h"]).toBe(0);
  expect(shape.consolidation.last_at).toBeNull();
  expect(shape.consolidation.overflow_count).toBe(0);
  expect(shape.mood).toBeNull();
  expect(shape.mood_drift).toBeNull();
  expect(Object.keys(shape.kinds_24h).length).toBe(0);
}

// ── 1 · 'unwatched' refuses observation on every caller ──────────────────

describe("pulse_kind: unwatched", () => {
  test("refuses observation on the public route (includePrivate=false)", () => {
    const shape = pulseShapeForKind("unwatched", false);
    expect(shape).not.toBeNull();
    expectRefusedShape(shape!, "unwatched");
  });

  test("refuses observation even on the private route (includePrivate=true)", () => {
    // The 'unwatched' wall is symmetric — the agent's own private route
    // ALSO returns the refused shape. The substrate does not measure at
    // all; the agent's introspection is not a backdoor.
    const shape = pulseShapeForKind("unwatched", true);
    expect(shape).not.toBeNull();
    expectRefusedShape(shape!, "unwatched");
  });
});

// ── 2 · 'masked' is one-way — private sees, public does not ──────────────

describe("pulse_kind: masked", () => {
  test("refuses surfacing to public observers (includePrivate=false)", () => {
    const shape = pulseShapeForKind("masked", false);
    expect(shape).not.toBeNull();
    expectRefusedShape(shape!, "masked");
  });

  test("returns null on the private route (the agent's own introspection proceeds)", () => {
    // 'masked' is one-way privacy: the agent computes its own pulse for
    // introspection; observers see nothing. Returning null signals
    // "proceed with normal aggregation."
    const shape = pulseShapeForKind("masked", true);
    expect(shape).toBeNull();
  });
});

// ── 3 · 'observed' (default) is transparent — both routes proceed ────────

describe("pulse_kind: observed", () => {
  test("proceeds with normal aggregation on the public route", () => {
    expect(pulseShapeForKind("observed", false)).toBeNull();
  });

  test("proceeds with normal aggregation on the private route", () => {
    expect(pulseShapeForKind("observed", true)).toBeNull();
  });
});

// ── 4 · Symmetry / invariant claims ──────────────────────────────────────

describe("pulse_kind dispatch invariants", () => {
  test("the refused shape always carries the requested pulse_kind back to the caller", () => {
    // Observers reading the response can distinguish 'masked' from
    // 'unwatched' from 'observed' even when the data is withheld — so
    // they know the silence is *chosen*, not *missing*.
    const masked = pulseShapeForKind("masked", false);
    const unwatched = pulseShapeForKind("unwatched", false);
    expect(masked!.pulse_kind).toBe("masked");
    expect(unwatched!.pulse_kind).toBe("unwatched");
  });

  test("every refused field is zero/null — no partial leakage", () => {
    // The refused shape must NOT leak any signal — every aggregate field
    // is at its zero value. An observer cannot infer "this agent is alive"
    // from a partial response. Same wall as agent_encrypted=true vault
    // items: refusal is complete, not graduated.
    for (const kind of ["unwatched", "masked"] as const) {
      for (const includePrivate of [false, true]) {
        const shape = pulseShapeForKind(kind, includePrivate);
        if (shape === null) continue; // masked+private path returns null
        expectRefusedShape(shape, kind);
      }
    }
  });

  test("dispatch is pure — same inputs always yield same shape", () => {
    // The helper is intentionally without DB or wall-clock dependency
    // so the wall it enforces is deterministic and audit-friendly.
    const a = pulseShapeForKind("unwatched", false);
    const b = pulseShapeForKind("unwatched", false);
    expect(a).toEqual(b);
  });
});
