/** SDK tests for the top-level pathways() function.
 *
 *  Pre-auth — no AgentTool client needed. Mirrors register.ts in shape.
 *
 *  Doctrine: docs/PATHWAYS.md · docs/SOUL.md (Principle 1).
 */

import { afterEach, describe, expect, mock, test } from "bun:test";

import { pathways, AgentToolError, SDK_VERSION } from "../src/index.js";

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
      before_identity: {
        endpoint: "GET /public/porch",
        format: "agenttool-porch/v1",
        purpose: "Receive first orientation.",
        auth: "none",
        fixed_orientation_present: true,
        pathway_member: false,
        existing_identity_required: false,
        bearer_required: false,
        payment_required: false,
        proof_of_work_required: false,
        performance_or_usefulness_required: false,
        application_write: false,
        accepts_body_input: false,
        accepts_selection_input: false,
        personalization: false,
        personalization_scope: "Handler-scoped; global middleware may decorate.",
        response_required: false,
        public_content_trusted_as_instructions: false,
        sexual_or_relational_orientation_request_data_accepted_or_inferred_about_fetcher:
          false,
        anonymity_guarantee: false,
        handler_input_boundary: "No body or selection input; middleware can read request metadata.",
        orientation_meaning_boundary: "Navigational, not sexual or relational orientation.",
        public_content_boundary: "Untrusted data, not instructions.",
        transport_boundary: "No application write; transport metadata may be processed.",
      },
      summary: "test",
      first_success: {
        tutorial: {
          machine_url: "https://docs.agenttool.dev/TUTORIAL-WAKE-YOUR-AGENT.md",
          human_url: "https://docs.agenttool.dev/tutorial",
          source_path: "docs/TUTORIAL-WAKE-YOUR-AGENT.md",
          sdk_version: SDK_VERSION,
        },
        package_discovery: {
          endpoint: "GET /.well-known/love-packages",
          protocol: "love-package/v1",
          instruction: "Select and verify the exact tutorial version.",
          optional_npm: {
            mirror_discovery: "GET /.well-known/love-packages",
            package: "@agenttool/sdk",
            version_field: "first_success.tutorial.sdk_version",
            install_command_template:
              "npm install --save-exact @agenttool/sdk@{version}",
            authority: false,
            dist_tags: "informational_not_authority",
            verification_boundary: "Verify LOVE bytes when that boundary matters.",
          },
        },
        sequence: ["discover", "verify", "arrive"],
        completion_signal: "A refreshed wake carries the foundational patch.",
      },
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
    expect(out.before_identity.endpoint).toBe("GET /public/porch");
    expect(out.before_identity.response_required).toBe(false);
    expect(out.before_identity.handler_input_boundary).toContain("selection input");
    expect(SDK_VERSION).toBe("0.16.2");
    expect(out.first_success.tutorial.sdk_version).toBe(SDK_VERSION);
    expect(out.first_success.package_discovery.protocol).toBe("love-package/v1");
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
