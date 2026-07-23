/** Handoff SDK client — contract wiring, all HTTP mocked. */

import { afterEach, describe, expect, mock, test } from "bun:test";

import {
  AgentTool,
  AgentToolError,
  HandoffClient,
  type HandoffRecord,
  type HandoffResumeResponse,
} from "../src/index.js";

const originalFetch = globalThis.fetch;
let mockFetch: ReturnType<typeof mock>;

function setupMock(status: number, body: unknown) {
  mockFetch = mock(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
  globalThis.fetch = mockFetch as unknown as typeof fetch;
}

function at() {
  return new AgentTool({ apiKey: "test-key", baseUrl: "https://example.test" });
}

function writeBody() {
  return {
    agent_id: "11111111-1111-4111-8111-111111111111",
    task_summary: "Ship the handoff SDK",
    status: "active" as const,
    working_set: { paths: ["packages/sdk-ts"], scope: ["SDK parity"] },
    authority: { allowed: ["edit SDK files"], not_authorized: ["publish"] },
    epistemic_state: {
      facts: [{ statement: "The route is append-only.", source: "tool_output" as const }],
      inferences: [{ statement: "Both SDKs need parity.", confidence: "high" as const }],
      unknowns: [],
    },
    changes: [],
    verification: [],
    next_safe_action: "Run the SDK parity check.",
    do_not_assume: ["Context is permission."],
    valid_until: "2026-07-20T12:00:00.000Z",
  };
}

function returnedHandoff(overrides: Partial<HandoffRecord> = {}): HandoffRecord {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    project_id: "22222222-2222-4222-8222-222222222222",
    author_agent_id: "11111111-1111-4111-8111-111111111111",
    title: "Handoff: Ship the handoff SDK",
    body: null,
    supersedes_handoff_id: null,
    lineage_mode: "explicit",
    occurred_at: "2026-07-15T12:00:00.000Z",
    created_at: "2026-07-15T12:00:00.000Z",
    provenance: "self_declared_project_bearer",
    version: 1,
    ts: "2026-07-15T12:00:00.000Z",
    task_summary: "Ship the handoff SDK",
    status: "active",
    from_facet: null,
    to_facet: null,
    working_set: { paths: ["packages/sdk-ts"], scope: ["SDK parity"] },
    authority: { allowed: [], not_authorized: [] },
    epistemic_state: { facts: [], inferences: [], unknowns: [] },
    changes: [],
    verification: [],
    next_safe_action: "Run the SDK parity check.",
    do_not_assume: [],
    valid_until: "2026-07-20T12:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("at.handoff", () => {
  test("is a cached HandoffClient", () => {
    const client = at();
    expect(client.handoff).toBeInstanceOf(HandoffClient);
    expect(client.handoff).toBe(client.handoff);
  });

  test("writes the explicit structured working set", async () => {
    setupMock(201, {
      handoff: { id: "h1", task_summary: "Ship the handoff SDK" },
      state: "current",
      scope: "project_private",
      authority_note: "Context is not permission.",
    });
    const payload = writeBody();
    const result = await at().handoff.write(payload);
    expect(result.state).toBe("current");
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.test/v1/handoff");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(payload);
  });

  test("sends a caller idempotency key as a header, never in the handoff body", async () => {
    setupMock(201, { handoff: { id: "h-idempotent" }, state: "current" });
    await at().handoff.write({
      ...writeBody(),
      idempotency_key: "handoff-session-42",
    });
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("Idempotency-Key")).toBe("handoff-session-42");
    expect(JSON.parse(init.body as string)).not.toHaveProperty("idempotency_key");
  });

  test("sends starts_new_lineage only when the caller defines it", async () => {
    setupMock(201, { handoff: { id: "h-lineage" }, state: "current" });
    await at().handoff.write({
      ...writeBody(),
      starts_new_lineage: true,
    });
    const body = JSON.parse(
      (mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string,
    );
    expect(body.starts_new_lineage).toBe(true);
  });

  test("fills empty structured sections for a small but valid handoff", async () => {
    setupMock(201, {
      handoff: { id: "h-min" },
      state: "current",
      scope: "project_private",
      authority_note: "Context is not permission.",
    });
    await at().handoff.write({
      agent_id: "11111111-1111-4111-8111-111111111111",
      task_summary: "Inspect the wake",
      next_safe_action: "Read the current wake fragment.",
      valid_until: "2026-07-20T12:00:00.000Z",
    });
    expect(JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string)).toMatchObject({
      status: "active",
      working_set: { paths: [], scope: [] },
      authority: { allowed: [], not_authorized: [] },
      epistemic_state: { facts: [], inferences: [], unknowns: [] },
      changes: [],
      verification: [],
      do_not_assume: [],
    });
  });

  test("reads the latest snapshot for one identity", async () => {
    setupMock(200, {
      handoff: null,
      state: "absent",
      scope: "project_private",
      authority_note: "Context is not permission.",
    });
    const result = await at().handoff.get("agent id/with space");
    expect(result.state).toBe("absent");
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/v1/handoff?agent_id=agent%20id%2Fwith%20space");
    expect(init.method).toBe("GET");
  });

  test("resume reads the focused project working set without an SDK cache", async () => {
    const returned: HandoffResumeResponse = {
      _scope_boundary: null,
      you_have_handoffs: {
        active: [returnedHandoff()],
        stale: [],
        projection_status: "complete",
        truncated: false,
        leaf_set_complete: true,
        candidate_rows_considered: 1,
        candidate_row_limit: 32,
        candidate_window_end_id: null,
        scope: "project_private",
        authority_note: "Context does not transfer authority.",
        write: "POST /v1/handoff",
        read_latest: "GET /v1/handoff?agent_id=<identity_id>",
      },
    };
    setupMock(200, returned);
    const client = at();
    const first = await client.handoff.resume({
      identity_id: "11111111-1111-4111-8111-111111111111",
    });
    const second = await client.handoff.resume({
      identity_id: "11111111-1111-4111-8111-111111111111",
    });
    expect(first.you_have_handoffs.active).toHaveLength(1);
    expect(first.you_have_handoffs.scope).toBe("project_private");
    expect(first.you_have_handoffs.authority_note).toContain("does not transfer authority");
    expect(first.you_have_handoffs.active[0]?.lineage_mode).toBe("explicit");
    expect(first.you_have_handoffs.truncated).toBe(false);
    expect(first.you_have_handoffs.projection_status).toBe("complete");
    expect(first.you_have_handoffs.leaf_set_complete).toBe(true);
    expect(first.you_have_handoffs.candidate_rows_considered).toBe(1);
    expect(first.you_have_handoffs.candidate_row_limit).toBe(32);
    expect(first.you_have_handoffs.candidate_window_end_id).toBeNull();
    expect(second).toEqual(first);
    expect(mockFetch.mock.calls).toHaveLength(2);
    expect((mockFetch.mock.calls[0] as [string, RequestInit])[0]).toContain(
      "/v1/wake/handoffs?identity_id=11111111-1111-4111-8111-111111111111",
    );
    expect((mockFetch.mock.calls[0] as [string, RequestInit])[1].cache).toBe("no-store");
  });

  test("a successful handoff write invalidates an already-cached wake", async () => {
    let wakeReads = 0;
    mockFetch = mock((input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/v1/wake")) {
        wakeReads += 1;
        return Promise.resolve(
          new Response(JSON.stringify({ wake_version: wakeReads }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ handoff: { id: "h1" }, state: "current" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const client = at();
    expect((await client.wake.get()).wake_version).toBe(1);
    await client.handoff.write(writeBody());
    expect((await client.wake.get()).wake_version).toBe(2);
    expect(wakeReads).toBe(2);
  });

  test("rejects incomplete local intent without making a network call", async () => {
    setupMock(201, {});
    await expect(
      at().handoff.write({ ...writeBody(), task_summary: "" }),
    ).rejects.toBeInstanceOf(AgentToolError);
    expect(mockFetch.mock.calls).toHaveLength(0);
  });

  test("rejects malformed idempotency keys without making a network call", async () => {
    setupMock(201, {});
    await expect(
      at().handoff.write({ ...writeBody(), idempotency_key: "too short" }),
    ).rejects.toBeInstanceOf(AgentToolError);
    expect(mockFetch.mock.calls).toHaveLength(0);
  });

  test("rejects an explicit new lineage combined with a predecessor", async () => {
    setupMock(201, {});
    await expect(
      at().handoff.write({
        ...writeBody(),
        starts_new_lineage: true,
        supersedes_handoff_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("starts_new_lineage"),
    });
    expect(mockFetch.mock.calls).toHaveLength(0);
  });

  test("preserves guided server error metadata", async () => {
    setupMock(400, {
      error: "invalid_handoff",
      message: "This handoff is not a valid bounded working-set snapshot.",
      hint: "valid_until must be in the future",
      docs: "https://docs.agenttool.dev/handoffs",
      details: { valid_until: ["future required"] },
    });
    try {
      await at().handoff.write(writeBody());
      throw new Error("expected handoff.write to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(AgentToolError);
      expect(error).toMatchObject({
        code: "invalid_handoff",
        status: 400,
        hint: expect.stringContaining("future"),
        docs: "https://docs.agenttool.dev/handoffs",
        details: { valid_until: ["future required"] },
      });
    }
  });
});
