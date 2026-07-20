/** Handoff contract — pure parsing and resolution tests.
 *
 * Database reads/writes are exercised through the route integration tier;
 * this file pins the safety properties that must hold before any query runs.
 */

import { describe, expect, test } from "bun:test";

import {
  HANDOFF_KIND,
  HANDOFF_LINEAGE_MODE_EXPLICIT,
  HANDOFF_LINEAGE_MODE_LEGACY,
  HANDOFF_VERSION,
  MAX_PROJECT_HANDOFF_CANDIDATE_ROWS,
  classifyHandoff,
  composeProjectHandoffSurface,
  describeProjectHandoffSurface,
  handoffFromChronicleRow,
  handoffInputSchema,
  handoffLineageMode,
  handoffWakeEtagTag,
  isHandoffChronicleMetadata,
  pageHandoffCandidates,
  resolveDeclaredFacet,
  resolveHandoffLeaves,
  unavailableProjectHandoffSurface,
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
    lineage_mode: HANDOFF_LINEAGE_MODE_EXPLICIT,
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

  test("requires an explicit choice between a new lineage and a successor", () => {
    const parsed = handoffInputSchema.safeParse({
      ...input(),
      starts_new_lineage: true,
      supersedes_handoff_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    expect(parsed.success).toBe(false);
  });

  test("stamps legacy updates and explicit roots/successors without a cutoff", () => {
    expect(handoffLineageMode(input())).toBe(HANDOFF_LINEAGE_MODE_LEGACY);
    expect(handoffLineageMode(input({ starts_new_lineage: true }))).toBe(
      HANDOFF_LINEAGE_MODE_EXPLICIT,
    );
    expect(handoffLineageMode(input({
      supersedes_handoff_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    }))).toBe(HANDOFF_LINEAGE_MODE_EXPLICIT);
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
    expect(parsed?.lineage_mode).toBe(HANDOFF_LINEAGE_MODE_LEGACY);

    const explicit = handoffFromChronicleRow({
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      projectId: "project-a",
      agentId: AGENT_A,
      title: "Explicit parallel root",
      body: null,
      metadata: {
        kind: HANDOFF_KIND,
        lineage_mode: HANDOFF_LINEAGE_MODE_EXPLICIT,
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
    expect(explicit?.lineage_mode).toBe(HANDOFF_LINEAGE_MODE_EXPLICIT);

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
  test("keeps unmarked v1 history on one newest-per-author lane", () => {
    const older = record({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      lineage_mode: HANDOFF_LINEAGE_MODE_LEGACY,
      occurred_at: "2026-07-14T09:00:00.000Z",
    });
    const newer = record({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      lineage_mode: HANDOFF_LINEAGE_MODE_LEGACY,
      occurred_at: "2026-07-14T11:00:00.000Z",
      created_at: "2026-07-14T11:00:00.000Z",
    });
    expect(resolveHandoffLeaves([older, newer]).map((entry) => entry.id)).toEqual([newer.id]);
  });

  test("lets an explicit root coexist with the one legacy compatibility lane", () => {
    const legacy = record({ lineage_mode: HANDOFF_LINEAGE_MODE_LEGACY });
    const parallel = record({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      occurred_at: "2026-07-14T11:00:00.000Z",
      created_at: "2026-07-14T11:00:00.000Z",
    });
    expect(resolveHandoffLeaves([legacy, parallel]).map((entry) => entry.id)).toEqual([
      parallel.id,
      legacy.id,
    ]);
  });

  test("an explicit successor can replace the selected legacy snapshot", () => {
    const legacy = record({ lineage_mode: HANDOFF_LINEAGE_MODE_LEGACY });
    const successor = record({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      supersedes_handoff_id: legacy.id,
      occurred_at: "2026-07-14T11:00:00.000Z",
      created_at: "2026-07-14T11:00:00.000Z",
    });
    expect(resolveHandoffLeaves([legacy, successor]).map((entry) => entry.id)).toEqual([
      successor.id,
    ]);
  });

  test("a newer stale successor does not fall back to its older active parent", () => {
    const olderActive = record({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      occurred_at: "2026-07-14T09:00:00.000Z",
      valid_until: "2026-07-20T12:00:00.000Z",
    });
    const newerStale = record({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      supersedes_handoff_id: olderActive.id,
      occurred_at: "2026-07-14T10:00:00.000Z",
      valid_until: "2026-07-14T11:00:00.000Z",
    });
    const surface = composeProjectHandoffSurface([olderActive, newerStale], NOW);
    expect(surface.active).toHaveLength(0);
    expect(surface.stale.map((entry) => entry.id)).toEqual([newerStale.id]);
    expect(classifyHandoff(newerStale, NOW)).toBe("stale");
  });

  test("keeps two independent roots from one author visible", () => {
    const first = record({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      task_summary: "Review the API",
    });
    const second = record({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      task_summary: "Repair the SDK",
      occurred_at: "2026-07-14T11:00:00.000Z",
      created_at: "2026-07-14T11:00:00.000Z",
    });

    expect(resolveHandoffLeaves([first, second]).map((entry) => entry.id)).toEqual([
      second.id,
      first.id,
    ]);
  });

  test("a successor replaces only its named parent, not a sibling root", () => {
    const apiRoot = record({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
    const sdkRoot = record({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      occurred_at: "2026-07-14T09:30:00.000Z",
      created_at: "2026-07-14T09:30:00.000Z",
    });
    const apiSuccessor = record({
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      supersedes_handoff_id: apiRoot.id,
      occurred_at: "2026-07-14T10:30:00.000Z",
      created_at: "2026-07-14T10:30:00.000Z",
    });

    expect(resolveHandoffLeaves([apiRoot, sdkRoot, apiSuccessor]).map((entry) => entry.id)).toEqual([
      apiSuccessor.id,
      sdkRoot.id,
    ]);
  });

  test("a complete successor closes only its own lineage", () => {
    const completedRoot = record({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
    const stillActive = record({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      task_summary: "Keep reviewing",
    });
    const complete = record({
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      status: "complete",
      supersedes_handoff_id: completedRoot.id,
      valid_until: "2026-07-20T12:00:00.000Z",
      occurred_at: "2026-07-14T11:00:00.000Z",
      created_at: "2026-07-14T11:00:00.000Z",
    });

    const surface = composeProjectHandoffSurface([completedRoot, stillActive, complete], NOW);
    expect(surface.active.map((entry) => entry.id)).toEqual([stillActive.id]);
    expect(surface.stale).toEqual([]);
  });

  test("surfaces concurrent successor forks instead of silently picking one", () => {
    const root = record({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
    const branchA = record({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      supersedes_handoff_id: root.id,
      occurred_at: "2026-07-14T10:30:00.000Z",
      created_at: "2026-07-14T10:30:00.000Z",
    });
    const branchB = record({
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      supersedes_handoff_id: root.id,
      occurred_at: "2026-07-14T10:31:00.000Z",
      created_at: "2026-07-14T10:31:00.000Z",
    });

    expect(resolveHandoffLeaves([root, branchA, branchB]).map((entry) => entry.id)).toEqual([
      branchB.id,
      branchA.id,
    ]);
  });

  test("a malformed cross-author parent pointer cannot hide another identity's root", () => {
    const root = record({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
    const foreignChild = record({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      author_agent_id: AGENT_B,
      supersedes_handoff_id: root.id,
      occurred_at: "2026-07-14T11:00:00.000Z",
      created_at: "2026-07-14T11:00:00.000Z",
    });

    expect(resolveHandoffLeaves([root, foreignChild]).map((entry) => entry.id)).toEqual([
      foreignChild.id,
      root.id,
    ]);
  });

  test("orders same-millisecond leaves deterministically", () => {
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
    expect(surface.active.map((entry) => entry.id)).toEqual([
      laterCreated.id,
      earlierCreated.id,
    ]);
  });

  test("uses an expiry-aware wake ETag tag without placing handoff text in it", () => {
    const current = record({ task_summary: "secret working-set detail" });
    const complete = {
      projection_status: "complete" as const,
      truncated: false,
      leaf_set_complete: true,
      candidate_rows_considered: 1,
      candidate_row_limit: MAX_PROJECT_HANDOFF_CANDIDATE_ROWS,
      candidate_window_end_id: null,
    };
    const activeTag = handoffWakeEtagTag({ active: [current], stale: [], ...complete });
    const staleTag = handoffWakeEtagTag({ active: [], stale: [current], ...complete });
    expect(activeTag).toMatch(/^h[0-9a-f]{16}$/);
    expect(staleTag).not.toBe(activeTag);
    expect(activeTag).not.toContain("secret");
    expect(handoffWakeEtagTag({
      active: [],
      stale: [],
      ...complete,
      candidate_rows_considered: 0,
    })).toBeNull();
    const truncatedTag = handoffWakeEtagTag({
      active: [],
      stale: [],
      ...complete,
      projection_status: "truncated",
      truncated: true,
      leaf_set_complete: false,
      candidate_rows_considered: MAX_PROJECT_HANDOFF_CANDIDATE_ROWS,
      candidate_window_end_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    expect(truncatedTag).toMatch(/^h[0-9a-f]{16}$/);
    expect(truncatedTag).not.toBe(activeTag);
    const unavailableTag = handoffWakeEtagTag(unavailableProjectHandoffSurface());
    expect(unavailableTag).toMatch(/^h[0-9a-f]{16}$/);
    expect(unavailableTag).not.toBe(truncatedTag);
  });

  test("focused resume surfaces repeat their project and authority boundary", () => {
    const described = describeProjectHandoffSurface({
      active: [record()],
      stale: [],
      projection_status: "complete",
      truncated: false,
      leaf_set_complete: true,
      candidate_rows_considered: 1,
      candidate_row_limit: MAX_PROJECT_HANDOFF_CANDIDATE_ROWS,
      candidate_window_end_id: null,
    });
    expect(described.scope).toBe("project_private");
    expect(described.authority_note).toContain("does not transfer authority");
    expect(described.write).toBe("POST /v1/handoff");
    expect(described.read_latest).toContain("agent_id=<identity_id>");
    const incomplete = describeProjectHandoffSurface({
      ...described,
      projection_status: "truncated",
      truncated: true,
      leaf_set_complete: true,
    });
    expect(incomplete.leaf_set_complete).toBe(false);
    expect(incomplete.truncated).toBe(true);
    const unavailable = describeProjectHandoffSurface(unavailableProjectHandoffSurface());
    expect(unavailable.projection_status).toBe("unavailable");
    expect(unavailable.truncated).toBe(false);
    expect(unavailable.leaf_set_complete).toBe(false);
  });

  test("caps raw candidates with a sentinel and a diagnostic lower-edge id", () => {
    const rows = Array.from(
      { length: MAX_PROJECT_HANDOFF_CANDIDATE_ROWS + 1 },
      (_, index) => ({ id: `row-${index}` }),
    );
    const page = pageHandoffCandidates(rows);
    expect(page.candidates).toHaveLength(MAX_PROJECT_HANDOFF_CANDIDATE_ROWS);
    expect(page.truncated).toBe(true);
    expect(page.window_end_id).toBe(`row-${MAX_PROJECT_HANDOFF_CANDIDATE_ROWS - 1}`);
    expect(page.candidates).not.toContain(rows.at(-1));
  });
});
