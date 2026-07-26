import { createHash } from "node:crypto";

import { describe, expect, test } from "bun:test";
import {
  AGENTTOOL_MARKETPLACE_PROVIDER_ID,
  AgentToolMarketplaceProvider,
  createDefaultSearchProviders,
  fetchFixedJson,
  FixedJsonTransportError,
  MCP_REGISTRY_PROVIDER_ID,
  McpRegistryProvider,
} from "../src/providers/index.js";

const observedAt = "2026-07-26T12:00:00.000Z";

function context(signal = new AbortController().signal) {
  return { observed_at: observedAt, signal };
}

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...Object.fromEntries(new Headers(init.headers).entries()),
    },
  });
}

describe("fixed provider JSON transport", () => {
  test("performs one bounded credential-free manual GET and hashes JSON bytes", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const body = JSON.stringify({ ok: true });
    const controller = new AbortController();
    const result = await fetchFixedJson(
      "https://fixed.example/search?q=private query",
      {
        expected_origin: "https://fixed.example",
        signal: controller.signal,
        fetch: async (input, init) => {
          calls.push({ input, init });
          return new Response(body, {
            headers: {
              "content-type": "application/vnd.example+json",
              "content-length": String(Buffer.byteLength(body)),
            },
          });
        },
        max_response_bytes: 1_024,
        boundary_codes: ["fixture_boundary"],
      },
    );

    expect(calls).toHaveLength(1);
    expect(String(calls[0]!.input)).toBe(
      "https://fixed.example/search?q=private%20query",
    );
    expect(calls[0]!.init).toMatchObject({
      method: "GET",
      credentials: "omit",
      redirect: "manual",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
    expect(new Headers(calls[0]!.init?.headers)).toMatchObject(
      expect.objectContaining({}),
    );
    expect(
      new Headers(calls[0]!.init?.headers).get("authorization"),
    ).toBeNull();
    expect(
      new Headers(calls[0]!.init?.headers).get("accept-encoding"),
    ).toBe("identity");
    expect(result.json).toEqual({ ok: true });
    expect(result.observation).toMatchObject({
      status: 200,
      media_type: "application/vnd.example+json",
      bytes: Buffer.byteLength(body),
      sha256: createHash("sha256").update(body).digest("hex"),
      boundary_codes: ["fixture_boundary"],
    });
    expect(result.observation.request_url).toContain("q=%5Bredacted%5D");
    expect(result.observation.request_url).not.toContain("private");
    expect(result.observation.final_url).not.toContain("private");
  });

  test("fails closed without retries, redirects, oversized bodies, or remote error leakage", async () => {
    let networkCalls = 0;
    const networkFailure = fetchFixedJson(
      "https://fixed.example/search?q=secret",
      {
        expected_origin: "https://fixed.example",
        signal: new AbortController().signal,
        fetch: async () => {
          networkCalls += 1;
          throw new Error("remote-secret-in-exception");
        },
      },
    );
    await expect(networkFailure).rejects.toMatchObject({
      code: "provider_network_error",
    });
    await expect(networkFailure).rejects.not.toThrow(
      /remote-secret-in-exception/u,
    );
    expect(networkCalls).toBe(1);

    await expect(
      fetchFixedJson("https://fixed.example/search", {
        expected_origin: "https://fixed.example",
        signal: new AbortController().signal,
        fetch: async () =>
          new Response(null, {
            status: 302,
            headers: { location: "https://elsewhere.example/private" },
          }),
      }),
    ).rejects.toMatchObject({ code: "provider_redirect" });

    await expect(
      fetchFixedJson("https://fixed.example/search", {
        expected_origin: "https://fixed.example",
        signal: new AbortController().signal,
        max_response_bytes: 4,
        fetch: async () =>
          new Response('{"remote_secret":"do not echo"}', {
            headers: { "content-type": "application/json" },
          }),
      }),
    ).rejects.toMatchObject({ code: "provider_response_too_large" });
  });

  test("validates fixed origin, media type, JSON, and the provided abort signal", async () => {
    await expect(
      fetchFixedJson("https://other.example/search", {
        expected_origin: "https://fixed.example",
        signal: new AbortController().signal,
        fetch: async () => jsonResponse({}),
      }),
    ).rejects.toMatchObject({ code: "provider_request_invalid" });

    await expect(
      fetchFixedJson("https://fixed.example/search", {
        expected_origin: "https://fixed.example",
        signal: new AbortController().signal,
        fetch: async () =>
          new Response("{}", {
            headers: { "content-type": "text/plain" },
          }),
      }),
    ).rejects.toMatchObject({ code: "provider_media_type_invalid" });

    const invalidJson = fetchFixedJson(
      "https://fixed.example/search",
      {
        expected_origin: "https://fixed.example",
        signal: new AbortController().signal,
        fetch: async () =>
          new Response('{"secret":"not closed"', {
            headers: { "content-type": "application/json" },
          }),
      },
    );
    await expect(invalidJson).rejects.toMatchObject({
      code: "provider_json_invalid",
    });
    await expect(invalidJson).rejects.not.toThrow(/not closed/u);

    const controller = new AbortController();
    controller.abort(new Error("private abort reason"));
    let calls = 0;
    await expect(
      fetchFixedJson("https://fixed.example/search", {
        expected_origin: "https://fixed.example",
        signal: controller.signal,
        fetch: async () => {
          calls += 1;
          return jsonResponse({});
        },
      }),
    ).rejects.toMatchObject({ code: "provider_aborted" });
    expect(calls).toBe(0);
  });
});

describe("AgentTool marketplace provider", () => {
  test("maps bounded listing results to capability and deduplicated agent candidates", async () => {
    const calls: string[] = [];
    const provider = new AgentToolMarketplaceProvider({
      fetch: async (input, init) => {
        calls.push(String(input));
        expect(init).toMatchObject({
          method: "GET",
          credentials: "omit",
          redirect: "manual",
        });
        return jsonResponse({
          listings: [
            {
              id: "listing/one",
              seller_did: "did:at:example.test/agent-one",
              name: "Browser research",
              description: "Research public sites.",
              capability_tags: ["browser", "research", "browser"],
              price_amount: 25,
              price_currency: "GBP",
              invocations_count: 7,
              created_at: "2026-07-20T10:00:00Z",
            },
            {
              id: "listing-two",
              seller_did: "did:at:example.test/agent-one",
              name: "Second service",
              capability_tags: ["analysis"],
              invocations_count: 2,
            },
          ],
        });
      },
    });

    const batch = await provider.search(
      {
        query: "browser & research",
        kinds: ["capability", "agent"],
        limit: 5,
      },
      context(),
    );

    expect(provider.id).toBe(AGENTTOOL_MARKETPLACE_PROVIDER_ID);
    expect(provider.kinds).toEqual(["agent", "capability"]);
    expect(provider.boundary).toMatchObject({
      credentials: "omitted",
      query_disclosed: true,
      connected_address_pinning: false,
    });
    expect(calls).toEqual([
      "https://api.agenttool.dev/public/listings?q=browser+%26+research&limit=5",
    ]);
    expect(batch.results.map((result) => result.kind)).toEqual([
      "capability",
      "agent",
      "capability",
    ]);
    expect(batch.results[0]).toMatchObject({
      title: "Browser research",
      target_url:
        "https://api.agenttool.dev/public/listings/listing%2Fone",
      capabilities: ["browser", "research"],
      provider_score: {
        value: 7,
        basis: "marketplace_invocations_count",
      },
    });
    expect(batch.results[1]).toMatchObject({
      kind: "agent",
      title: "did:at:example.test/agent-one",
      target_url:
        "https://api.agenttool.dev/public/agents/did%3Aat%3Aexample.test%2Fagent-one",
    });
    expect(batch.results[0]!.claims).toContainEqual({
      key: "seller.did",
      value: "did:at:example.test/agent-one",
      basis: "publisher_assertion",
    });
    expect(batch.results[0]!.claims).toContainEqual({
      key: "listing.price_amount_minor",
      value: 25,
      basis: "publisher_assertion",
    });
    expect(batch.results[0]!.claims).toContainEqual({
      key: "listing.invocations_count",
      value: 7,
      basis: "provider_assertion",
    });
    expect(batch.observation.request_url).not.toContain("browser");
    expect(batch.next_cursor).toBeUndefined();
  });

  test("rejects cursors before fetch and quarantines malformed listing rows", async () => {
    let calls = 0;
    const provider = new AgentToolMarketplaceProvider({
      fetch: async () => {
        calls += 1;
        return jsonResponse({
          listings: [
            { id: "missing-required-fields" },
            {
              id: "valid",
              seller_did: "did:example:agent",
              name: "Valid",
            },
          ],
        });
      },
    });

    await expect(
      provider.search(
        {
          query: "valid",
          kinds: ["capability"],
          limit: 2,
          cursor: "provider-owned-but-unsupported",
        },
        context(),
      ),
    ).rejects.toMatchObject({ code: "provider_cursor_unsupported" });
    expect(calls).toBe(0);

    const batch = await provider.search(
      { query: "valid", kinds: ["capability"], limit: 2 },
      context(),
    );
    expect(batch.results).toHaveLength(1);
  });
});

describe("official MCP Registry provider", () => {
  test("preserves opaque cursor and chooses website, repository, then exact entry URLs", async () => {
    const calls: string[] = [];
    const cursor = "opaque cursor:+/=";
    const provider = new McpRegistryProvider({
      fetch: async (input) => {
        calls.push(String(input));
        return jsonResponse({
          servers: [
            {
              server: {
                name: "io.example/weather",
                title: "Weather",
                description: "Weather forecasts.",
                version: "1.2.3",
                websiteUrl: "https://weather.example/docs",
                repository: {
                  url: "https://github.com/example/weather",
                  source: "github",
                },
                packages: [
                  { registryType: "npm" },
                  { registryType: "npm" },
                ],
                remotes: [{ type: "streamable-http" }],
              },
              _meta: {
                "io.modelcontextprotocol.registry/official": {
                  status: "active",
                  publishedAt: "2026-07-01T10:00:00Z",
                  updatedAt: "2026-07-02T10:00:00Z",
                  isLatest: true,
                },
              },
            },
            {
              server: {
                name: "io.example/repository-only",
                description: "Repository only.",
                version: "2.0.0",
                websiteUrl: "javascript:alert(1)",
                repository: {
                  url: "https://codeberg.org/example/repository-only",
                  source: "codeberg",
                },
              },
            },
            {
              server: {
                name: "io.example/registry-only",
                description: "Registry fallback.",
                version: "3.0.0+build.1",
              },
            },
            {
              server: {
                name: "io.example/deleted",
                description: "Deleted.",
                version: "1.0.0",
              },
              _meta: {
                "io.modelcontextprotocol.registry/official": {
                  status: "deleted",
                },
              },
            },
          ],
          metadata: {
            count: 4,
            nextCursor: "next:opaque/byte string",
          },
        });
      },
    });

    const batch = await provider.search(
      {
        query: "weather mcp",
        kinds: ["mcp_server"],
        limit: 4,
        cursor,
      },
      context(),
    );

    expect(provider.id).toBe(MCP_REGISTRY_PROVIDER_ID);
    expect(provider.kinds).toEqual(["mcp_server"]);
    expect(calls).toEqual([
      "https://registry.modelcontextprotocol.io/v0.1/servers?search=weather+mcp&limit=4&version=latest&cursor=opaque+cursor%3A%2B%2F%3D",
    ]);
    expect(batch.next_cursor).toBe("next:opaque/byte string");
    expect(batch.results.map((result) => result.target_url)).toEqual([
      "https://weather.example/docs",
      "https://codeberg.org/example/repository-only",
      "https://registry.modelcontextprotocol.io/v0.1/servers/io.example%2Fregistry-only/versions/3.0.0%2Bbuild.1",
    ]);
    expect(batch.results[0]).toMatchObject({
      kind: "mcp_server",
      title: "Weather",
      summary: "Weather forecasts.",
      published_at: "2026-07-01T10:00:00.000Z",
      modified_at: "2026-07-02T10:00:00.000Z",
    });
    expect(batch.results[0]!.claims).toContainEqual({
      key: "server.package_registry_types",
      value: ["npm"],
      basis: "publisher_assertion",
    });
    expect(batch.results[0]!.claims).toContainEqual({
      key: "registry.entry_url",
      value:
        "https://registry.modelcontextprotocol.io/v0.1/servers/io.example%2Fweather/versions/1.2.3",
      basis: "local_derivation",
    });
    expect(batch.results[0]!.claims).toContainEqual({
      key: "registry.status",
      value: "active",
      basis: "provider_assertion",
    });
    expect(batch.results[2]).toMatchObject({
      mime_type: "application/json",
    });
    expect(batch.observation.request_url).not.toContain("weather");
    expect(batch.observation.request_url).not.toContain("opaque");
  });

  test("returns no MCP candidates for an unsupported requested kind", async () => {
    const provider = new McpRegistryProvider({
      fetch: async () =>
        jsonResponse({
          servers: [
            {
              server: {
                name: "io.example/server",
                description: "A server.",
                version: "1.0.0",
              },
            },
          ],
        }),
    });
    const batch = await provider.search(
      { query: "server", kinds: ["agent"], limit: 1 },
      context(),
    );
    expect(batch.results).toEqual([]);
  });
});

test("default providers are fresh and expose the fixed provider order", () => {
  const first = createDefaultSearchProviders();
  const second = createDefaultSearchProviders();
  expect(first.map((provider) => provider.id)).toEqual([
    AGENTTOOL_MARKETPLACE_PROVIDER_ID,
    MCP_REGISTRY_PROVIDER_ID,
  ]);
  expect(first[0]).not.toBe(second[0]);
  expect(first[1]).not.toBe(second[1]);
  expect(first.every((provider) => provider instanceof Object)).toBe(true);
  expect(
    new FixedJsonTransportError("provider_network_error").message,
  ).toBe("The provider request failed.");
});
