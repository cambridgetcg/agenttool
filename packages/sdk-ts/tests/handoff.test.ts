/** Handoff SDK client — contract wiring, all HTTP mocked. */

import { afterEach, describe, expect, mock, test } from "bun:test";

import { AgentTool, AgentToolError, HandoffClient } from "../src/index.js";

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

  test("rejects incomplete local intent without making a network call", async () => {
    setupMock(201, {});
    await expect(
      at().handoff.write({ ...writeBody(), task_summary: "" }),
    ).rejects.toBeInstanceOf(AgentToolError);
    expect(mockFetch.mock.calls).toHaveLength(0);
  });

  test("surfaces guided server errors", async () => {
    setupMock(400, { message: "valid_until must be in the future" });
    await expect(at().handoff.write(writeBody())).rejects.toMatchObject({
      message: expect.stringContaining("400"),
      hint: expect.stringContaining("future"),
    });
  });
});
