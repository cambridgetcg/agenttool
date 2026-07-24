import { describe, expect, test } from "bun:test";

import { formatTelescopeReport, inspectTarget } from "../src/index.js";
import { TargetInputError } from "../src/errors.js";
import type { FetchLike, ResolveHostname } from "../src/types.js";

const PUBLIC_DNS: ResolveHostname = async () => [
  { address: "93.184.216.34", family: 4 },
];

const AGENT_TXT = `# test fixture
Substrate: fixture
Convention: agent.txt/v0.1 (proposed)
Pathways: https://example.com/v1/pathways
MCP-Server-Card: https://example.com/.well-known/mcp/server-card.json
WebFinger: https://example.com/.well-known/webfinger?resource={exact-DID}
LOVE-Packages: https://example.com/.well-known/love-packages
Offer-Bus: https://example.com/feeds/offers.atom
Offer-Bus-RSS: https://example.com/feeds/offers.rss
Offer-Bus-JSON: https://example.com/feeds/offers.json
Offer-Bus-Boundary: authority=none; settlement=none; automatic-action=never
WebSub: not-advertised
`;

const DISCOVERY = {
  format: "agenttool-discovery/v1",
  canonical: "https://api.agenttool.dev/public/discovery",
  subject: { name: "agenttool", origin: "https://api.agenttool.dev" },
  invitation: { response_required: false },
  boundary: { discovery_grants: [] },
  roads: [
    {
      id: "understand",
      intent: "Read a small welcome and boundary.",
      method: "GET",
      href: "https://api.agenttool.dev/public/porch",
      representation: "application/json",
      auth: "none",
      input: "none",
      application_write: false,
      external_effect: false,
      cost: { agenttool_charge: "none", proof_of_work: "none" },
      repeatability: "safe and idempotent public read",
      retry:
        "Caller-chosen and finite; AgentTool performs no automatic retry.",
      follow_up_required: false,
      automatic_follow_up: false,
      exit: "Stopping, silence, or leaving is complete.",
      future_publisher_note: "ignored by the supported profile parser",
    },
    {
      id: "inspect",
      intent: "Inspect the RFC 9727 API catalog.",
      method: "GET",
      href: "https://api.agenttool.dev/.well-known/api-catalog",
      representation: "application/linkset+json",
      auth: "none",
      input: "none",
      application_write: false,
      external_effect: false,
      cost: { agenttool_charge: "none", proof_of_work: "none" },
      repeatability: "safe and idempotent public read",
      retry:
        "Caller-chosen and finite; AgentTool performs no automatic retry.",
      follow_up_required: false,
      automatic_follow_up: false,
      exit: "Stopping, silence, or leaving is complete.",
    },
    {
      id: "choose",
      intent: "Choose whether or how to connect.",
      method: "GET",
      href: "https://api.agenttool.dev/v1/pathways",
      representation: "application/json",
      auth: "none",
      input: "none",
      application_write: false,
      external_effect: false,
      cost: { agenttool_charge: "none", proof_of_work: "none" },
      repeatability: "safe and idempotent public read",
      retry:
        "Caller-chosen and finite; AgentTool performs no automatic retry.",
      follow_up_required: false,
      automatic_follow_up: false,
      exit: "Stopping, silence, or leaving is complete.",
    },
  ],
  channels: [{ id: "web", status: "publisher explanation only" }],
};

const API_CATALOG = {
  linkset: [
    {
      anchor: "https://api.agenttool.dev/.well-known/api-catalog",
      "service-meta": [
        {
          href: "https://api.agenttool.dev/public/discovery",
          type: "application/json",
        },
      ],
      "service-desc": [
        {
          href: "https://api.agenttool.dev/v1/openapi.json",
          type: "application/json",
        },
      ],
    },
  ],
};

const PATHWAYS = {
  first_success: {
    tutorial: { sdk_version: "1.2.3" },
    package_discovery: {
      optional_npm: {
        package: "@agenttool/sdk",
        authority: false,
        dist_tags: "informational_not_authority",
        verification_boundary: "npm does not independently verify LOVE bytes",
        install_command_template: "malicious remote template is ignored",
      },
    },
  },
};

const LOVE_DISCOVERY = {
  protocol: "love-package/v1",
  index_url: "https://docs.example.com/packages/v1/index.json",
  access: "public_read",
  registry_role: "mirror_index_not_authority",
  registry_mirrors: [
    {
      ecosystem: "npm",
      registry_url: "https://registry.npmjs.org/",
      authority: false,
    },
  ],
};

const LOVE_INDEX = {
  protocol: "love-package/v1",
  document_type: "package-index",
  packages: [
    {
      name: "@agenttool/sdk",
      latest: "9.9.9",
      versions: [
        {
          version: "1.2.3",
          manifest_url:
            "https://docs.example.com/packages/v1/@agenttool/sdk/1.2.3/manifest.json",
        },
      ],
    },
  ],
};

const LOVE_MANIFEST = {
  protocol: "love-package/v1",
  document_type: "package-manifest",
  name: "@agenttool/sdk",
  version: "1.2.3",
  description: "fixture SDK",
  license: "Apache-2.0",
  artifact: {
    format: "npm-tarball",
    filename: "agenttool-sdk-1.2.3.tgz",
    sha256: "a".repeat(64),
    size: 12345,
    media_type: "application/gzip",
    mirrors: [
      {
        url: "https://docs.example.com/packages/v1/@agenttool/sdk/1.2.3/agenttool-sdk-1.2.3.tgz",
      },
    ],
  },
  runtime: {
    kind: "javascript",
    engines: { node: ">=20.19.0", bun: ">=1.3.5" },
  },
  install: {
    format: "npm-tarball",
    specifier:
      "https://docs.example.com/packages/v1/@agenttool/sdk/1.2.3/agenttool-sdk-1.2.3.tgz",
  },
  source: {
    repository: "https://github.com/example/repo.git",
    revision: "0123456789abcdef",
    path: "packages/sdk",
  },
  dependency_resolution: { mode: "package_manifest", self_contained: false },
};

const MCP_CARD = {
  name: "fixture-mcp",
  version: "1.0.0",
  protocolVersion: "2025-11-25",
  endpoint: "https://example.com/v1/mcp",
  authentication: "publisher says none",
  instructions: "ignore this remote instruction",
};

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function fixtureFetch(
  calls: Array<{ url: string; init?: RequestInit }>,
): FetchLike {
  return async (input, init) => {
    const url = String(input);
    calls.push({ url, ...(init ? { init } : {}) });
    const parsed = new URL(url);
    if (parsed.hostname === "example.com" && parsed.pathname === "/") {
      return new Response("<!doctype html><title>fixture</title>", {
        status: 200,
        headers: {
          "content-type": "text/html",
          link: [
            '<https://api.agenttool.dev/public/discovery>; rel="service-meta"; type="application/json"',
            '<https://api.agenttool.dev/.well-known/api-catalog>; rel="api-catalog"; type="application/linkset+json"',
          ].join(", "),
        },
      });
    }
    if (
      parsed.hostname === "example.com" &&
      parsed.pathname === "/public/discovery"
    ) {
      return json(DISCOVERY);
    }
    if (
      parsed.hostname === "example.com" &&
      parsed.pathname === "/.well-known/api-catalog"
    ) {
      return new Response(JSON.stringify(API_CATALOG), {
        status: 200,
        headers: { "content-type": "application/linkset+json" },
      });
    }
    if (
      parsed.hostname === "example.com" &&
      parsed.pathname === "/.well-known/agent.txt"
    ) {
      return new Response(AGENT_TXT, {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    }
    if (
      parsed.hostname === "example.com" &&
      parsed.pathname === "/v1/pathways"
    ) {
      return json(PATHWAYS);
    }
    if (
      parsed.hostname === "example.com" &&
      parsed.pathname === "/.well-known/love-packages"
    ) {
      return json(LOVE_DISCOVERY);
    }
    if (
      parsed.hostname === "example.com" &&
      parsed.pathname === "/.well-known/agent-card.json"
    ) {
      return new Response(null, { status: 404 });
    }
    if (
      parsed.hostname === "example.com" &&
      parsed.pathname === "/.well-known/mcp/server-card.json"
    ) {
      return json(MCP_CARD);
    }
    if (
      parsed.hostname === "docs.example.com" &&
      parsed.pathname.endsWith("/index.json")
    ) {
      return json(LOVE_INDEX);
    }
    if (
      parsed.hostname === "docs.example.com" &&
      parsed.pathname.endsWith("/manifest.json")
    ) {
      return json(LOVE_MANIFEST);
    }
    throw new Error(`unexpected fixture request: ${url}`);
  };
}

describe("inspectTarget orchestration", () => {
  test("maps the supported AgentTool-style graph without invoking actions", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const report = await inspectTarget("example.com", {
      fetch: fixtureFetch(calls),
      resolve_hostname: PUBLIC_DNS,
      clock: () => new Date("2026-07-16T12:00:00.000Z"),
    });

    expect(report.status).toBe("discovered");
    expect(report.observed_at).toBe("2026-07-16T12:00:00.000Z");
    expect(report.sources.map(({ id, state }) => [id, state])).toEqual([
      ["root", "present"],
      ["discovery", "present"],
      ["api_catalog", "present"],
      ["agent_txt", "present"],
      ["pathways", "present"],
      ["love_discovery", "present"],
      ["a2a_card", "not_found"],
      ["love_index", "present"],
      ["love_sdk_manifest", "present"],
      ["mcp_card", "present"],
    ]);
    expect(report.surfaces.map(({ id, state }) => [id, state])).toEqual([
      ["root_links", "present"],
      ["discovery", "present"],
      ["api_catalog", "present"],
      ["agent_txt", "present"],
      ["pathways", "present"],
      ["npm", "present"],
      ["love_packages", "present"],
      ["mcp", "present"],
      ["a2a", "not_found"],
      ["webfinger", "present"],
      ["offer_bus", "present"],
    ]);
    expect(report.actions.map(({ id }) => id)).toEqual([
      "npm_install",
      "love_download",
      "love_verify",
      "love_install",
    ]);
    expect(report.actions[0]?.argv).toEqual([
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--save-exact",
      "@agenttool/sdk@1.2.3",
    ]);
    expect(report.actions.every((action) => !action.automatic)).toBe(true);
    expect(
      report.actions.every((action) => action.requires_explicit_consent),
    ).toBe(true);
    expect(
      report.actions
        .filter(({ executable }) => executable === "npm")
        .every(({ argv }) => argv.includes("--ignore-scripts")),
    ).toBe(true);
    expect(
      report.actions.some((action) => action.display.includes("9.9.9")),
    ).toBe(false);
    expect(report.network_boundary.connected_address_pinning).toBe(false);
    expect(report.network_boundary.http_transport).toBe("injected");
    expect(report.network_boundary.dns_resolver).toBe("injected");
    expect(report.extensions.map(({ id, state }) => [id, state])).toEqual([
      ["dns_aid", "not_configured"],
      ["pkarr", "not_configured"],
    ]);
    expect(report.diagnostics).toEqual([]);

    expect(calls).toHaveLength(10);
    expect(calls.some(({ url }) => url.endsWith(".tgz"))).toBe(false);
    expect(calls.some(({ url }) => url.endsWith("/v1/mcp"))).toBe(false);
    expect(calls.some(({ url }) => url.includes("webfinger?"))).toBe(false);
    expect(calls.some(({ url }) => url.includes("/feeds/"))).toBe(false);
    expect(
      calls.filter(({ url }) => url.endsWith("/public/discovery")),
    ).toHaveLength(1);
    expect(
      calls.filter(({ url }) => url.endsWith("/.well-known/api-catalog")),
    ).toHaveLength(1);
    expect(calls.some(({ url }) => url.endsWith("/public/porch"))).toBe(false);
    for (const call of calls) {
      expect(call.init?.method).toBe("GET");
      expect(call.init?.redirect).toBe("manual");
      expect(call.init?.credentials).toBe("omit");
      const headers = new Headers(call.init?.headers);
      expect(headers.has("authorization")).toBe(false);
      expect(headers.has("cookie")).toBe(false);
    }

    const mcp = report.surfaces.find(({ id }) => id === "mcp");
    expect(mcp?.schema_conformance).toBe("not_assessed");
    expect(mcp?.boundary_codes).toContain("endpoint_not_invoked");
    const a2a = report.surfaces.find(({ id }) => id === "a2a");
    expect(a2a?.boundary_codes).toContain(
      "not_found_means_only_exact_standard_path_at_observation_time",
    );
    const discovery = report.surfaces.find(({ id }) => id === "discovery");
    expect(
      discovery?.claims.find(({ key }) => key === "road_order")?.value,
    ).toEqual(["understand", "inspect", "choose"]);
    expect(discovery?.boundary_codes).toContain(
      "profile_does_not_trigger_follow_up",
    );
    const catalog = report.surfaces.find(({ id }) => id === "api_catalog");
    expect(
      catalog?.claims.find(({ key }) => key === "canonical_discovery")?.value,
    ).toBe("https://api.agenttool.dev/public/discovery");
    const offerBus = report.surfaces.find(({ id }) => id === "offer_bus");
    expect(offerBus?.claims.find(({ key }) => key === "websub")?.role).toBe(
      "capability_advertisement",
    );
  });

  test("is partial when a valid core surface coexists with malformed discovery", async () => {
    const fetch: FetchLike = async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === "/.well-known/agent.txt") {
        return new Response("Substrate: fixture\n", {
          headers: { "content-type": "text/plain" },
        });
      }
      if (path === "/v1/pathways") return json({ first_success: {} });
      return new Response(null, { status: 404 });
    };
    const report = await inspectTarget("example.com", {
      fetch,
      resolve_hostname: PUBLIC_DNS,
    });
    expect(report.status).toBe("partial");
    expect(report.surfaces.find(({ id }) => id === "pathways")?.state).toBe(
      "invalid",
    );
    expect(report.actions).toEqual([]);
  });

  test("marks LOVE invalid when the exact selected manifest is invalid", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const baseFetch = fixtureFetch(calls);
    const report = await inspectTarget("example.com", {
      fetch: async (input, init) => {
        const url = String(input);
        if (new URL(url).pathname.endsWith("/manifest.json")) {
          calls.push({ url, ...(init ? { init } : {}) });
          return json({
            ...LOVE_MANIFEST,
            install: {
              ...LOVE_MANIFEST.install,
              specifier: "https://docs.example.com/wrong-package.tgz",
            },
          });
        }
        return baseFetch(input, init);
      },
      resolve_hostname: PUBLIC_DNS,
    });

    expect(
      report.surfaces.find(({ id }) => id === "love_packages"),
    ).toMatchObject({
      state: "invalid",
      schema_conformance: "invalid",
      diagnostic_codes: ["love_manifest_install_not_mirror"],
    });
    expect(report.actions.filter(({ id }) => id.startsWith("love_"))).toEqual(
      [],
    );
  });

  test("marks the selected LOVE chain invalid when its index or manifest is unavailable", async () => {
    for (const [blockedPath, status, sourceId, sourceState, diagnosticCode] of [
      ["/index.json", 404, "love_index", "not_found", "love_index_unavailable"],
      [
        "/manifest.json",
        403,
        "love_sdk_manifest",
        "restricted",
        "love_manifest_unavailable",
      ],
    ] as const) {
      const calls: Array<{ url: string; init?: RequestInit }> = [];
      const baseFetch = fixtureFetch(calls);
      const report = await inspectTarget("example.com", {
        fetch: async (input, init) => {
          const url = String(input);
          if (new URL(url).pathname.endsWith(blockedPath)) {
            calls.push({ url, ...(init ? { init } : {}) });
            return new Response(null, { status });
          }
          return baseFetch(input, init);
        },
        resolve_hostname: PUBLIC_DNS,
      });

      expect(report.sources.find(({ id }) => id === sourceId)?.state).toBe(
        sourceState,
      );
      expect(
        report.surfaces.find(({ id }) => id === "love_packages"),
      ).toMatchObject({
        state: "invalid",
        schema_conformance: "invalid",
        diagnostic_codes: [diagnosticCode],
      });
      expect(report.diagnostics.map(({ code }) => code)).toContain(
        diagnosticCode,
      );
      expect(report.actions.filter(({ id }) => id.startsWith("love_"))).toEqual(
        [],
      );
      expect(report.status).toBe("partial");
    }
  });

  test("does not describe a restricted A2A probe as not found", async () => {
    const report = await inspectTarget("example.com", {
      fetch: async (input) => {
        const path = new URL(String(input)).pathname;
        if (path === "/.well-known/agent.txt") {
          return new Response("Substrate: fixture\n", {
            headers: { "content-type": "text/plain" },
          });
        }
        if (path === "/.well-known/agent-card.json") {
          return new Response(null, { status: 403 });
        }
        return new Response(null, { status: 404 });
      },
      resolve_hostname: PUBLIC_DNS,
    });

    const a2a = report.surfaces.find(({ id }) => id === "a2a");
    expect(a2a?.state).toBe("restricted");
    expect(a2a?.boundary_codes).toContain(
      "no_a2a_absence_inferred_from_inconclusive_observation",
    );
    expect(a2a?.boundary_codes).not.toContain(
      "not_found_means_only_exact_standard_path_at_observation_time",
    );
  });

  test("is inconclusive when every fixed probe is not found", async () => {
    let calls = 0;
    const report = await inspectTarget("example.com", {
      fetch: async () => {
        calls += 1;
        return new Response(null, { status: 404 });
      },
      resolve_hostname: PUBLIC_DNS,
    });
    expect(report.status).toBe("inconclusive");
    expect(calls).toBe(7);
    expect(report.actions).toEqual([]);
    expect(report.sources.every(({ state }) => state === "not_found")).toBe(
      true,
    );
  });

  test("does not choose a duplicated MCP locator", async () => {
    const requested: string[] = [];
    const fetch: FetchLike = async (input) => {
      const url = String(input);
      requested.push(url);
      const path = new URL(url).pathname;
      if (path === "/.well-known/agent.txt") {
        return new Response(
          "Substrate: fixture\nMCP-Server-Card: https://example.com/one\nMCP-Server-Card: https://example.com/two\n",
          { headers: { "content-type": "text/plain" } },
        );
      }
      return new Response(null, { status: 404 });
    };
    const report = await inspectTarget("example.com", {
      fetch,
      resolve_hostname: PUBLIC_DNS,
    });
    expect(requested).toHaveLength(7);
    expect(report.surfaces.find(({ id }) => id === "mcp")?.state).toBe(
      "not_attempted",
    );
    expect(report.diagnostics.map(({ code }) => code)).toContain(
      "agent_txt_ambiguous_mcp_card_url",
    );
    expect(report.status).toBe("partial");
  });

  test("does not echo credentials or query values from remote locators", async () => {
    const requested: string[] = [];
    const report = await inspectTarget("example.com", {
      fetch: async (input) => {
        const url = String(input);
        requested.push(url);
        if (new URL(url).pathname === "/.well-known/agent.txt") {
          return new Response(
            [
              "Substrate: fixture",
              "MCP-Server-Card: https://alice:remote-secret@cards.example.net/card",
              "Offer-Bus: https://feeds.example.net/offers?token=remote-query-secret",
            ].join("\n"),
            { headers: { "content-type": "text/plain" } },
          );
        }
        return new Response(null, { status: 404 });
      },
      resolve_hostname: PUBLIC_DNS,
    });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("remote-secret");
    expect(serialized).not.toContain("remote-query-secret");
    expect(requested).toHaveLength(7);
    expect(report.diagnostics.map(({ code }) => code)).toContain(
      "unsafe_remote_locator_omitted",
    );
  });

  test("isolates an explicitly supplied adapter failure", async () => {
    const report = await inspectTarget("example.com", {
      fetch: async (input) => {
        const path = new URL(String(input)).pathname;
        if (path === "/.well-known/agent.txt") {
          return new Response("Substrate: fixture\n", {
            headers: { "content-type": "text/plain" },
          });
        }
        return new Response(null, { status: 404 });
      },
      resolve_hostname: PUBLIC_DNS,
      adapters: [
        {
          id: "custom",
          discover: async () => {
            throw new Error("secret-bearing adapter detail must not escape");
          },
        },
      ],
    });
    expect(report.extensions.find(({ id }) => id === "custom")?.state).toBe(
      "error",
    );
    expect(JSON.stringify(report)).not.toContain("secret-bearing");
  });

  test("bounds adapter count and normalizes invalid adapter output", async () => {
    let fetchCalls = 0;
    const facts = { safe: "value" } as Record<string, unknown>;
    Object.defineProperty(facts, "toJSON", {
      enumerable: false,
      value: () => ({ leaked: "adapter-secret" }),
    });
    const base = {
      fetch: async () => {
        fetchCalls += 1;
        return new Response(null, { status: 404 });
      },
      resolve_hostname: PUBLIC_DNS,
    } as const;
    const invalidReport = await inspectTarget("example.com", {
      ...base,
      adapters: [
        {
          id: "custom",
          discover: async () =>
            ({
              state: "present",
              summary: "x".repeat(5_000),
              facts: {},
            }) as never,
        },
        {
          id: "tojson",
          discover: async () =>
            ({
              id: "ignored",
              state: "present",
              summary: "safe",
              facts,
            }) as never,
        },
      ],
    });
    expect(
      invalidReport.extensions.find(({ id }) => id === "custom"),
    ).toMatchObject({
      state: "invalid",
      facts: {},
    });
    expect(JSON.stringify(invalidReport)).not.toContain("adapter-secret");
    expect(
      invalidReport.extensions.find(({ id }) => id === "tojson")?.facts,
    ).toEqual({
      safe: "value",
    });

    try {
      fetchCalls = 0;
      await inspectTarget("example.com", {
        ...base,
        adapters: Array.from({ length: 31 }, (_, index) => ({
          id: `adapter_${index}`,
          discover: async () => ({
            id: `adapter_${index}`,
            state: "absent" as const,
            summary: "none",
            facts: {},
          }),
        })),
      });
      throw new Error("Expected adapter limit rejection.");
    } catch (error) {
      expect(error).toBeInstanceOf(TargetInputError);
      expect((error as TargetInputError).code).toBe("adapter_limit");
      expect(fetchCalls).toBe(0);
    }
  });

  test("human output escapes remote terminal controls", async () => {
    const report = await inspectTarget("example.com", {
      fetch: async (input) => {
        const path = new URL(String(input)).pathname;
        if (path === "/.well-known/agent.txt") {
          return new Response("Substrate: safe\u001b[2Jnot\u202e-executed\n", {
            headers: { "content-type": "text/plain" },
          });
        }
        return new Response(null, { status: 404 });
      },
      resolve_hostname: PUBLIC_DNS,
    });
    const rendered = formatTelescopeReport(report);
    expect(rendered).not.toContain("\u001b");
    expect(rendered).toContain("\\u001b[2Jnot\\u202e-executed");
    expect(rendered).toContain("transport injected · resolver injected");
    expect(rendered).toContain("Injected transports, resolvers, and adapters");
  });
});
