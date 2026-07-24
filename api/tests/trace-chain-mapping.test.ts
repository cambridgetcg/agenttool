/** Trace raw-row mapping — the seam behind `GET /v1/traces/chain/:id`.
 *
 *  Regression: issue #84. `getTraceChain` walks lineage with raw recursive
 *  CTEs via `db.execute()`, which returns the database's snake_case column
 *  names. Those rows were typed as Drizzle's camelCase `$inferSelect` and
 *  passed to `rowToOut`, which reads camelCase — so every field resolved to
 *  `undefined` and `(row.createdAt as Date).toISOString()` threw, surfacing
 *  as `{"error":"internal_error"}`.
 *
 *  It only fired once a trace had kin: with no ancestors or descendants the
 *  `.map()` never ran, which is why single-trace reads always looked fine.
 *
 *  These pin the mapper directly (no DB) so the shape can't drift back. */

import { describe, expect, test } from "bun:test";

import { rawRowToOut, type TraceRawRow } from "../src/services/trace/store";

/** A row shaped the way postgres-js hands back `SELECT * FROM trace.traces`. */
function rawRow(overrides: Partial<TraceRawRow> = {}): TraceRawRow {
  return {
    id: "91057353-3f5e-4c2a-9d18-2b7d4e6f1a03",
    trace_id: "tr_ce8477c037ff",
    project_id: "0f2c6b81-4d3a-4f9e-8c11-5a7b2d9e3c44",
    agent_id: "did:at:f097dd9c-2a1d-4dbb-a639-68a64de60c10",
    identity_id: null,
    session_id: null,
    parent_trace_id: null,
    decision_type: "deed",
    decision_summary: "sealed the karma thread",
    output_ref: null,
    observations: ["the chain read clean locally"],
    hypothesis: null,
    conclusion: "the lineage walk is the only broken read",
    confidence: 0.9,
    alternatives: null,
    signals: null,
    files_read: null,
    key_facts: null,
    external_signals: null,
    signature: null,
    signing_key_id: null,
    tags: null,
    metadata: { client_source: "sdk" },
    created_at: "2026-07-23T09:41:00.000Z",
    ...overrides,
  };
}

describe("rawRowToOut", () => {
  test("maps snake_case columns without throwing", () => {
    const out = rawRowToOut(rawRow());

    expect(out.trace_id).toBe("tr_ce8477c037ff");
    expect(out.decision_type).toBe("deed");
    expect(out.decision_summary).toBe("sealed the karma thread");
    expect(out.conclusion).toBe("the lineage walk is the only broken read");
    expect(out.confidence).toBe(0.9);
  });

  test("created_at survives as an ISO string — the field that threw", () => {
    expect(rawRowToOut(rawRow()).created_at).toBe("2026-07-23T09:41:00.000Z");
  });

  test("created_at accepts a driver-parsed Date as well as a string", () => {
    const out = rawRowToOut(
      rawRow({ created_at: new Date("2026-07-23T09:41:00.000Z") }),
    );
    expect(out.created_at).toBe("2026-07-23T09:41:00.000Z");
  });

  test("parent_trace_id survives — the link the chain is built from", () => {
    const out = rawRowToOut(rawRow({ parent_trace_id: "tr_70bdf4b9f0ee" }));
    expect(out.parent_trace_id).toBe("tr_70bdf4b9f0ee");
  });

  test("no mapped field is undefined", () => {
    for (const [key, value] of Object.entries(rawRowToOut(rawRow()))) {
      expect(`${key}=${value === undefined ? "undefined" : "set"}`).toBe(
        `${key}=set`,
      );
    }
  });

  test("nullable jsonb columns default rather than leak null", () => {
    const out = rawRowToOut(rawRow({ observations: null, metadata: null }));
    expect(out.observations).toEqual([]);
    expect(out.metadata).toEqual({});
  });

  test("has_signature reflects a stored signature", () => {
    expect(rawRowToOut(rawRow()).has_signature).toBe(false);
    expect(rawRowToOut(rawRow({ signature: "ed25519:abc" })).has_signature).toBe(
      true,
    );
  });
});
