/** Handoff contract — pure parsing and resolution tests.
 *
 * Database reads/writes are exercised through the route integration tier;
 * this file pins the safety properties that must hold before any query runs.
 */

import { describe, expect, test } from "bun:test";

import {
  HANDOFF_KIND,
  HANDOFF_VERSION,
  classifyHandoff,
  composeProjectHandoffSurface,
  handoffFromChronicleRow,
  handoffInputSchema,
  handoffWakeEtagTag,
  isHandoffChronicleMetadata,
  resolveDeclaredFacet,
  validateHandoffFreshness,
  validateHandoffSize,
  type HandoffRecord,
} from "../src/services/handoff/store";

const AGENT_A = "11111111-1111-4111-8111-111111111111";
const AGENT_B = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-07-14T12:00:00.000Z");

function input(overrides: Record<string, unknown> = {}) {
  return handoffInputSchema.parse({
    agent_id: AGENT_A,
    task_summary: "Build the coordination surface",
    status: "active",
    from_facet: null,
    to_facet: null,
    working_set: { paths: ["api/src/routes/handoff.ts"], scope: ["handoff API"] },
    authority: { allowed: ["edit scoped files"], not_authorized: ["deploy"] },
    epistemic_state: {
      facts: [{ statement: "Chronicle has parent links.", source: "tool_output" }],
      inferences: [{ statement: "No migration is needed.", confidence: "high" }],
      unknowns: ["SDK ergonomics"],
    },
    changes: ["Added the route"],
    verification: [{ check: "typecheck", result: "passed" }],
    next_safe_action: "Run focused tests.",
    do_not_assume: ["A handoff is permission."],
    valid_until: "2026-07-20T12:00:00.000Z",
    ...overrides,
  });
}

function record(overrides: Partial<HandoffRecord> = {}): HandoffRecord {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    project_id: "project-a",
    author_agent_id: AGENT_A,
    title: "Handoff: Build the coordination surface",
    body: null,
    supersedes_handoff_id: null,
    occurred_at: "2026-07-14T10:00:00.000Z",
    created_at: "2026-07-14T10:00:00.000Z",
    provenance: "self_declared_project_bearer",
    version: HANDOFF_VERSION,
    ts: "2026-07-14T10:00:00.000Z",
    task_summary: "Build the coordination surface",
    status: "active",
    from_facet: null,
    to_facet: null,
    working_set: { paths: ["api/src/routes/handoff.ts"], scope: ["handoff API"] },
    authority: { allowed: ["edit scoped files"], not_authorized: ["deploy"] },
    epistemic_state: {
      facts: [],
      inferences: [],
      unknowns: [],
    },
    changes: [],
    verification: [],
    next_safe_action: "Run focused tests.",
    do_not_assume: [],
    valid_until: "2026-07-20T12:00:00.000Z",
    ...overrides,
  };
}

describe("handoff input contract", () => {
  test("accepts a bounded, explicit working set", () => {
    expect(input().task_summary).toBe("Build the coordination surface");
  });

  test("rejects caller-controlled or unknown fields", () => {
    const parsed = handoffInputSchema.safeParse({
      ...input(),
      project_id: "should-be-derived",
    });
    expect(parsed.success).toBe(false);
  });

  test("requires a future expiry no more than 30 days away", () => {
    expect(validateHandoffFreshness(input({ valid_until: "2026-07-14T11:59:59.000Z" }), NOW)).toContain(
      "future",
    );
    expect(validateHandoffFreshness(input({ valid_until: "2026-08-14T12:00:01.000Z" }), NOW)).toContain(
      "30 days",
    );
    expect(validateHandoffFreshness(input(), NOW)).toBeNull();
  });

  test("caps a syntactically valid but context-bloating working set", () => {
    const oversized = input({
      changes: Array.from({ length: 50 }, () => "x".repeat(1000)),
    });
    expect(validateHandoffSize(oversized)).toContain("working-set limit");
  });
});

describe("handoff facets", () => {
  const expression = {
    subagents: [
      { name: "Builder", facet: "ships" },
      { name: "Reviewer", facet: "checks" },
    ],
  };

  test("normalizes declared facets case-insensitively", () => {
    expect(resolveDeclaredFacet(expression, "builder")).toEqual({ valid: true, value: "Builder" });
  });

  test("refuses undeclared facets while leaving omitted facets valid", () => {
    expect(resolveDeclaredFacet(expression, "Operator")).toEqual({ valid: false, value: null });
    expect(resolveDeclaredFacet(expression, null)).toEqual({ valid: true, value: null });
  });
});

describe("handoff chronicle mapping", () => {
  test("accepts only a well-formed versioned handoff envelope", () => {
    const { agent_id: _agentId, supersedes_handoff_id: _supersedes, ...stored } = input();
    const parsed = handoffFromChronicleRow({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      projectId: "project-a",
      agentId: AGENT_A,
      title: "Handoff: Build the coordination surface",
      body: null,
      metadata: {
        kind: HANDOFF_KIND,
        handoff: {
          ...stored,
          version: HANDOFF_VERSION,
          ts: "2026-07-14T10:00:00.000Z",
          from_facet: null,
          to_facet: null,
        },
      },
      parentChronicleId: null,
      occurredAt: NOW,
      createdAt: NOW,
    });
    expect(parsed?.author_agent_id).toBe(AGENT_A);
    expect(parsed?.provenance).toBe("self_declared_project_bearer");

    const malformed = handoffFromChronicleRow({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      projectId: "project-a",
      agentId: AGENT_A,
      title: "Old note",
      body: null,
      metadata: { kind: HANDOFF_KIND, handoff: { version: 99 } },
      parentChronicleId: null,
      occurredAt: NOW,
      createdAt: NOW,
    });
    expect(malformed).toBeNull();
  });

  test("keeps every reserved handoff envelope out of generic wake chronicle previews", () => {
    expect(isHandoffChronicleMetadata({ kind: HANDOFF_KIND, handoff: { version: 99 } })).toBe(true);
    expect(isHandoffChronicleMetadata({ kind: "not-a-handoff" })).toBe(false);
  });
});

describe("handoff resolution", () => {
  test("a newer stale snapshot does not fall back to an older active one", () => {
    const olderActive = record({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      occurred_at: "2026-07-14T09:00:00.000Z",
      valid_until: "2026-07-20T12:00:00.000Z",
    });
    const newerStale = record({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      occurred_at: "2026-07-14T10:00:00.000Z",
      valid_until: "2026-07-14T11:00:00.000Z",
    });
    const surface = composeProjectHandoffSurface([olderActive, newerStale], NOW);
    expect(surface.active).toHaveLength(0);
    expect(surface.stale.map((entry) => entry.id)).toEqual([newerStale.id]);
    expect(classifyHandoff(newerStale, NOW)).toBe("stale");
  });

  test("complete snapshots stay in chronicle history but leave the active wake", () => {
    const complete = record({
      author_agent_id: AGENT_B,
      status: "complete",
      valid_until: "2026-07-20T12:00:00.000Z",
    });
    const surface = composeProjectHandoffSurface([complete], NOW);
    expect(surface.active).toEqual([]);
    expect(surface.stale).toEqual([]);
  });

  test("breaks same-millisecond newest ties deterministically", () => {
    const earlierCreated = record({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      occurred_at: "2026-07-14T10:00:00.000Z",
      created_at: "2026-07-14T10:00:00.000Z",
    });
    const laterCreated = record({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      occurred_at: "2026-07-14T10:00:00.000Z",
      created_at: "2026-07-14T10:00:00.001Z",
    });
    const surface = composeProjectHandoffSurface([laterCreated, earlierCreated], NOW);
    expect(surface.active.map((entry) => entry.id)).toEqual([laterCreated.id]);
  });

  test("uses an expiry-aware wake ETag tag without placing handoff text in it", () => {
    const current = record({ task_summary: "secret working-set detail" });
    const activeTag = handoffWakeEtagTag({ active: [current], stale: [] });
    const staleTag = handoffWakeEtagTag({ active: [], stale: [current] });
    expect(activeTag).toMatch(/^h[0-9a-f]{16}$/);
    expect(staleTag).not.toBe(activeTag);
    expect(activeTag).not.toContain("secret");
    expect(handoffWakeEtagTag({ active: [], stale: [] })).toBeNull();
  });
});
