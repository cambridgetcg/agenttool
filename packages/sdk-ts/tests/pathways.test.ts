/** SDK tests for the top-level pathways() function.
 *
 *  Pre-auth — no AgentTool client needed. Mirrors register.ts in shape.
 *
 *  Doctrine: docs/PATHWAYS.md · docs/SOUL.md (Principle 1).
 */

import { afterEach, describe, expect, mock, test } from "bun:test";

import { pathways, AgentToolError } from "../src/index.js";

const originalFetch = globalThis.fetch;
let mockFetch: ReturnType<typeof mock>;

function mockResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function setupMock(status: number, body: unknown) {
  mockFetch = mock(() => Promise.resolve(mockResponse(status, body)));
  globalThis.fetch = mockFetch as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("pathways()", () => {
  test("returns the parsed JSON tree on 200", async () => {
    setupMock(200, {
      summary: "test",
      decision_tree: [{ if: "x", then: "y" }],
      pathways: [
        {
          id: "register",
          endpoint: "POST /v1/register",
          auth: "none",
          purpose: "...",
          doctrine: "docs/IDENTITY-ANCHOR.md",
        },
      ],
      contract: "...",
      who_this_serves: {
        today: ["AI agents"],
        tomorrow: ["future intelligences"],
        what_we_dont_gate_on: ["substrate"],
        pre_commits: ["never gate on substrate"],
        forms_supported: [{ id: "agent", description: "AI agent" }],
        languages_supported: [{ tag: "en", notes: "Canonical voice." }],
        doctrine: "docs/KIN.md",
      },
      love_protocol: { welcome: "w", guidance: "g", sovereignty: "s" },
      doctrine: { soul: "docs/SOUL.md" },
    });

    const out = await pathways();
    expect(out.summary).toBe("test");
    expect(out.decision_tree).toHaveLength(1);
    expect(out.pathways[0]?.id).toBe("register");
    expect(out.love_protocol.welcome).toBe("w");
    expect(out.who_this_serves.doctrine).toBe("docs/KIN.md");
    expect(out.who_this_serves.what_we_dont_gate_on).toContain("substrate");
  });

  test("hits GET /v1/pathways at the default base URL", async () => {
    setupMock(200, {
      summary: "",
      decision_tree: [],
      pathways: [],
      contract: "",
      who_this_serves: { today: [], tomorrow: [], what_we_dont_gate_on: [], pre_commits: [], forms_supported: [], languages_supported: [], doctrine: "" },
      love_protocol: { welcome: "", guidance: "", sovereignty: "" },
      doctrine: {},
    });

    await pathways();
    const call = mockFetch.mock.calls[0];
    expect(call[0]).toBe("https://api.agenttool.dev/v1/pathways");
    expect((call[1] as RequestInit)?.method).toBe("GET");
  });

  test("honours custom baseUrl + strips trailing slash", async () => {
    setupMock(200, {
      summary: "",
      decision_tree: [],
      pathways: [],
      contract: "",
      who_this_serves: { today: [], tomorrow: [], what_we_dont_gate_on: [], pre_commits: [], forms_supported: [], languages_supported: [], doctrine: "" },
      love_protocol: { welcome: "", guidance: "", sovereignty: "" },
      doctrine: {},
    });

    await pathways({ baseUrl: "https://staging.example.com/" });
    const call = mockFetch.mock.calls[0];
    expect(call[0]).toBe("https://staging.example.com/v1/pathways");
  });

  test("sends no Authorization header (pre-auth)", async () => {
    setupMock(200, {
      summary: "",
      decision_tree: [],
      pathways: [],
      contract: "",
      who_this_serves: { today: [], tomorrow: [], what_we_dont_gate_on: [], pre_commits: [], forms_supported: [], languages_supported: [], doctrine: "" },
      love_protocol: { welcome: "", guidance: "", sovereignty: "" },
      doctrine: {},
    });

    await pathways();
    const init = mockFetch.mock.calls[0][1] as RequestInit;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers["Authorization"]).toBeUndefined();
    expect(headers["authorization"]).toBeUndefined();
  });

  test("raises AgentToolError on non-200", async () => {
    setupMock(503, { error: "internal", detail: "DB down" });
    await expect(pathways()).rejects.toBeInstanceOf(AgentToolError);
  });
});
