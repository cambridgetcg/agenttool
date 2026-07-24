/** Public MCP server — official Streamable HTTP conformance slice.
 *
 * Pins transport boundaries, the existing read-only resource/tool surface,
 * and one official SDK Client round-trip through the full application
 * middleware stack.
 *
 * Doctrine: docs/ALIGNMENT-MOVES.md (Move 1) · docs/ECOSYSTEM.md.
 */

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import mcpRouter, {
  MCP_MAX_BODY_BYTES,
  MCP_PROTOCOL_VERSION,
} from "../src/routes/mcp";
import {
  buildDiscoveryCompass,
  DISCOVERY_MEDIA_TYPE,
  serializeDiscoveryCompass,
} from "../src/services/discovery/compass";
import {
  createFixedWindowLimiter,
  PUBLIC_MCP_REQUEST_LIMIT,
  PUBLIC_MCP_TOOL_LIMIT,
  resetPublicMcpLimitsForTests,
  takePublicMcpLimit,
} from "../src/services/mcp/rate-limit";

const STREAMABLE_ACCEPT = "application/json, text/event-stream";
const MCP_INSTRUCTIONS =
  "AgentTool offers agenttool://discovery as a read-only compass with three optional roads: understand, inspect, or choose. Stopping, silence, and leaving are complete. agenttool://canon and canon.summary offer optional depth. Reading grants no authority and starts no follow-up. No tool writes, pays, installs, invokes another agent, or schedules follow-up work.";
const INIT_PARAMS = {
  protocolVersion: MCP_PROTOCOL_VERSION,
  capabilities: {},
  clientInfo: { name: "agenttool-wire-test", version: "1.0.0" },
};

async function rpc(
  method: string,
  params?: unknown,
  id: string | number = 1,
  headers: Record<string, string> = {},
) {
  const res = await mcpRouter.request("/", {
    method: "POST",
    headers: {
      accept: STREAMABLE_ACCEPT,
      "content-type": "application/json",
      ...(method === "initialize"
        ? {}
        : { "mcp-protocol-version": MCP_PROTOCOL_VERSION }),
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  return { status: res.status, body: await res.json(), headers: res.headers };
}

describe("public MCP Streamable HTTP wire", () => {
  beforeEach(() => {
    resetPublicMcpLimitsForTests();
  });

  test("GET returns 405 because this stateless server offers no SSE listener", async () => {
    const res = await mcpRouter.request("/", {
      method: "GET",
      headers: { accept: "text/event-stream" },
    });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
    expect((await res.json()).id).toBeNull();
  });

  test("rejects a cross-origin browser connection before reading its body", async () => {
    const res = await mcpRouter.request("/", {
      method: "POST",
      headers: {
        accept: STREAMABLE_ACCEPT,
        "content-type": "application/json",
        origin: "https://unrelated.example",
      },
      body: "x".repeat(MCP_MAX_BODY_BYTES + 1),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.message).toMatch(/Origin/);
    const firstRequestDecision = takePublicMcpLimit("request", "unknown");
    expect(firstRequestDecision.allowed).toBe(true);
    if (firstRequestDecision.allowed) {
      expect(firstRequestDecision.remaining).toBe(
        PUBLIC_MCP_REQUEST_LIMIT.limit - 1,
      );
    }
  });

  test("accepts the configured public browser origin", async () => {
    const { status, body } = await rpc(
      "initialize",
      INIT_PARAMS,
      1,
      { origin: "https://api.agenttool.dev" },
    );
    expect(status).toBe(200);
    expect(body.result.serverInfo.name).toBe("agenttool");
  });

  test("does not trust an attacker-controlled request host as an allowed origin", async () => {
    const res = await mcpRouter.request("https://evil.example/", {
      method: "POST",
      headers: {
        accept: STREAMABLE_ACCEPT,
        "content-type": "application/json",
        origin: "https://evil.example",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: INIT_PARAMS,
      }),
    });
    expect(res.status).toBe(403);
  });

  test("rejects Origin values that are URLs rather than serialized origins", async () => {
    for (const origin of [
      "https://api.agenttool.dev/path",
      "https://user@api.agenttool.dev",
      "https://api.agenttool.dev?x",
      "https://api.agenttool.dev#x",
      "https://api.agenttool.dev https://evil.example",
      "https://api.agenttool.dev\\evil.example",
      "https://%61pi.agenttool.dev",
      "https://api.agenttool.dev:0443",
    ]) {
      const { status } = await rpc("initialize", INIT_PARAMS, 1, { origin });
      expect(status).toBe(403);
    }
  });

  test("POST requires both JSON and SSE response types in Accept", async () => {
    for (const accept of [
      "application/json",
      "application/jsonp, text/event-streaming",
      "application/json; q=0, text/event-stream",
      "application/json, text/event-stream; q=0",
      'application/json;foo="x,y";q=0, text/event-stream',
      "application/json;foo=x, text/event-stream",
    ]) {
      const res = await mcpRouter.request("/", {
        method: "POST",
        headers: {
          accept,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: INIT_PARAMS,
        }),
      });
      expect(res.status).toBe(406);
      expect((await res.json()).error.message).toMatch(
        /both application\/json and text\/event-stream/,
      );
    }
  });

  test("POST requires an exact JSON request media type", async () => {
    for (const contentType of [
      "text/plain",
      "text/plain; note=application/json",
      "application/jsonp",
      "application/json;foo=x, text/plain",
      'application/json;foo="unterminated',
      "application/json; =broken",
      "application/json; charset=iso-8859-1",
    ]) {
      const res = await mcpRouter.request("/", {
        method: "POST",
        headers: {
          accept: STREAMABLE_ACCEPT,
          "content-type": contentType,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: INIT_PARAMS,
        }),
      });
      expect(res.status).toBe(415);
      expect((await res.json()).error.message).toMatch(
        /Content-Type must be application\/json/,
      );
    }
  });

  test("valid media type case and q weights survive SDK dispatch", async () => {
    for (const [accept, contentType] of [
      ["Application/JSON, Text/Event-Stream", "Application/JSON; Charset=UTF-8"],
      ["application/json;q=0.5, text/event-stream;q=1", "application/json"],
    ]) {
      const res = await mcpRouter.request("/", {
        method: "POST",
        headers: {
          accept,
          "content-type": contentType,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: INIT_PARAMS,
        }),
      });
      expect(res.status).toBe(200);
      expect((await res.json()).result.protocolVersion).toBe(
        MCP_PROTOCOL_VERSION,
      );
    }
  });

  test("initialize negotiates the current version and read-only capabilities", async () => {
    const { status, body } = await rpc("initialize", INIT_PARAMS);
    expect(status).toBe(200);
    expect(body).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: expect.objectContaining({
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          resources: { subscribe: false, listChanged: false },
          tools: { listChanged: false },
        },
        serverInfo: { name: "agenttool", version: "1.0.0" },
      }),
    });
    expect(body.result.instructions).toBe(MCP_INSTRUCTIONS);
  });

  test("initialize falls back to a supported version when the requested one is unknown", async () => {
    const { status, body } = await rpc("initialize", {
      ...INIT_PARAMS,
      protocolVersion: "2099-01-01",
    });
    expect(status).toBe(200);
    expect(body.result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
  });

  test("initialize negotiates historical clients onto the one supported revision", async () => {
    for (const protocolVersion of [
      "2025-03-26",
      "2025-06-18",
      "2024-11-05",
    ]) {
      const { status, body } = await rpc("initialize", {
        ...INIT_PARAMS,
        protocolVersion,
      });
      expect(status).toBe(200);
      expect(body.result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
    }
  });

  test("does not repair malformed initialize parameters", async () => {
    for (const params of [
      {
        capabilities: {},
        clientInfo: INIT_PARAMS.clientInfo,
      },
      {
        ...INIT_PARAMS,
        protocolVersion: 20251125,
      },
    ]) {
      const res = await mcpRouter.request("/", {
        method: "POST",
        headers: {
          accept: STREAMABLE_ACCEPT,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params,
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.result).toBeUndefined();
      expect(body.error.code).toBe(-32602);
    }
  });

  test("rejects an unsupported MCP-Protocol-Version after initialization", async () => {
    const { status, body } = await rpc(
      "ping",
      undefined,
      2,
      { "mcp-protocol-version": "2099-01-01" },
    );
    expect(status).toBe(400);
    expect(body.error.message).toMatch(/Unsupported protocol version/);
  });

  test("requires the negotiated MCP-Protocol-Version after initialization", async () => {
    const res = await mcpRouter.request("/", {
      method: "POST",
      headers: {
        accept: STREAMABLE_ACCEPT,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "ping",
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(
      /requires MCP-Protocol-Version: 2025-11-25/,
    );
  });

  test("requires the version header on client responses as well as requests", async () => {
    const res = await mcpRouter.request("/", {
      method: "POST",
      headers: {
        accept: STREAMABLE_ACCEPT,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        result: {},
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.id).toBeNull();
    expect(body.error.message).toMatch(
      /requires MCP-Protocol-Version: 2025-11-25/,
    );
  });

  test("notifications return 202 with no body", async () => {
    const res = await mcpRouter.request("/", {
      method: "POST",
      headers: {
        accept: STREAMABLE_ACCEPT,
        "content-type": "application/json",
        "mcp-protocol-version": MCP_PROTOCOL_VERSION,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    });
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("");
  });

  test("initialize notifications cannot bypass version or start a session", async () => {
    for (const headers of [
      {},
      { "mcp-protocol-version": MCP_PROTOCOL_VERSION },
    ]) {
      const res = await mcpRouter.request("/", {
        method: "POST",
        headers: {
          accept: STREAMABLE_ACCEPT,
          "content-type": "application/json",
          ...headers,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "initialize",
          params: INIT_PARAMS,
        }),
      });
      expect(res.status).toBe(400);
      expect(await res.text()).toBe("");
    }
  });

  test("null request IDs are rejected", async () => {
    const res = await mcpRouter.request("/", {
      method: "POST",
      headers: {
        accept: STREAMABLE_ACCEPT,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        method: "initialize",
        params: INIT_PARAMS,
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe(-32600);
  });

  test("invalid JSON returns a protocol parse error", async () => {
    const res = await mcpRouter.request("/", {
      method: "POST",
      headers: {
        accept: STREAMABLE_ACCEPT,
        "content-type": "application/json",
      },
      body: "this is not json",
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe(-32700);
  });

  test("non-UTF-8 JSON bytes return a protocol parse error", async () => {
    const before = new TextEncoder().encode(
      '{"jsonrpc":"2.0","id":2,"method":"ping","params":{"value":"',
    );
    const after = new TextEncoder().encode('"}}');
    const bytes = new Uint8Array(before.length + 1 + after.length);
    bytes.set(before);
    bytes[before.length] = 0xe9;
    bytes.set(after, before.length + 1);

    const res = await mcpRouter.request("/", {
      method: "POST",
      headers: {
        accept: STREAMABLE_ACCEPT,
        "content-type": "application/json",
        "mcp-protocol-version": MCP_PROTOCOL_VERSION,
      },
      body: bytes,
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe(-32700);
  });

  test("valid JSON with an invalid JSON-RPC envelope is not a parse error", async () => {
    for (const body of [
      7,
      { jsonrpc: "2.0", id: 1.5, method: "ping" },
      { jsonrpc: "2.0", id: null, method: "ping" },
    ]) {
      const res = await mcpRouter.request("/", {
        method: "POST",
        headers: {
          accept: STREAMABLE_ACCEPT,
          "content-type": "application/json",
          "mcp-protocol-version": MCP_PROTOCOL_VERSION,
        },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
      const error = await res.json();
      expect(error.id).toBeNull();
      expect(error.error.code).toBe(-32600);
    }
  });

  test("transport media checks happen before custom protocol handling", async () => {
    for (const body of [
      [
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { arguments: {} },
        },
      ],
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {},
      },
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { arguments: {} },
      },
    ]) {
      const unacceptable = await mcpRouter.request("/", {
        method: "POST",
        headers: {
          accept: "text/plain",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
      expect(unacceptable.status).toBe(406);

      const unsupported = await mcpRouter.request("/", {
        method: "POST",
        headers: {
          accept: STREAMABLE_ACCEPT,
          "content-type": "text/plain; note=application/json",
        },
        body: JSON.stringify(body),
      });
      expect(unsupported.status).toBe(415);
    }
  });

  test("request bodies are capped before protocol parsing", async () => {
    const res = await mcpRouter.request("/", {
      method: "POST",
      headers: {
        accept: STREAMABLE_ACCEPT,
        "content-type": "application/json",
      },
      body: "x".repeat(MCP_MAX_BODY_BYTES + 1),
    });
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.id).toBeNull();
    expect(body.error.message).toMatch(/capped/);
  });

  test("unknown methods return method-not-found", async () => {
    const { body } = await rpc("does_not_exist");
    expect(body.error.code).toBe(-32601);
  });

  test("resources offer the shared discovery compass before optional canon depth", async () => {
    const { body: listed } = await rpc("resources/list");
    const resources = listed.result.resources as Array<{
      uri: string;
      name: string;
      description?: string;
      mimeType?: string;
    }>;
    const uris = resources.map(
      (resource: { uri: string }) => resource.uri,
    );
    expect(resources[0]).toEqual({
      uri: "agenttool://discovery",
      name: "AgentTool discovery compass",
      description:
        "Three optional public roads—understand, inspect, or choose—and a complete exit. Reading selects nothing, grants no authority, and starts no follow-up.",
      mimeType: DISCOVERY_MEDIA_TYPE,
    });
    expect(uris).toContain("agenttool://discovery");
    expect(uris).toContain("agenttool://canon");
    expect(uris).toContain("agenttool://canon/types");
    expect(uris).toContain("agenttool://wake/platform");
    expect(
      uris.filter((uri: string) =>
        uri.startsWith("agenttool://canon/urn:agenttool:"),
      ).length,
    ).toBeGreaterThan(10);

    const { body: discoveryRead } = await rpc("resources/read", {
      uri: "agenttool://discovery",
    });
    expect(discoveryRead.result.contents).toEqual([
      {
        uri: "agenttool://discovery",
        mimeType: DISCOVERY_MEDIA_TYPE,
        text: serializeDiscoveryCompass(),
      },
    ]);
    const compass = JSON.parse(discoveryRead.result.contents[0].text);
    expect(compass).toEqual(buildDiscoveryCompass());
    expect(compass.canonical).toBe(
      "https://api.agenttool.dev/public/discovery",
    );
    expect(compass.roads.map((road: { id: string }) => road.id)).toEqual([
      "understand",
      "inspect",
      "choose",
    ]);

    const { body: read } = await rpc("resources/read", {
      uri: "agenttool://canon/urn:agenttool:doc/SOUL",
    });
    const concept = JSON.parse(read.result.contents[0].text);
    expect(concept.urn).toBe("agenttool:doc/SOUL");
    expect(concept.type_simple).toBe("DoctrineDoc");
  });

  test("unknown resource URIs return resource-not-found", async () => {
    for (const uri of [
      "agenttool://nope/x",
      "agenttool://canon/by-type/not-a-real-type",
      "agenttool://canon/by-type/%",
    ]) {
      const { body } = await rpc("resources/read", { uri });
      expect(body.error.code).toBe(-32002);
      expect(body.error.data).toEqual({ uri });
    }
  });

  test("tools retain the existing read-only canon and wake surface", async () => {
    const { body: listed } = await rpc("tools/list");
    const names = listed.result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "canon.lookup",
        "canon.by_type",
        "canon.list_types",
        "canon.summary",
        "wake.platform",
      ]),
    );
    expect(names).not.toEqual(
      expect.arrayContaining([
        "memory.append",
        "strand.append",
        "inbox.send",
        "covenant.propose",
      ]),
    );
    for (const tool of listed.result.tools) {
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    }

    const { body: called } = await rpc("tools/call", {
      name: "canon.summary",
      arguments: {},
    });
    const summary = JSON.parse(called.result.content[0].text);
    expect(summary.totalConcepts).toBeGreaterThan(50);
    expect(called.result.isError).toBeFalsy();
  });

  test("unknown tools are protocol errors", async () => {
    const { body } = await rpc("tools/call", {
      name: "unknown.tool",
      arguments: {},
    });
    expect(body.error.code).toBe(-32602);
    expect(body.error.message).toContain("Unknown tool: unknown.tool");
  });

  test("known tool input errors are actionable tool results without coercion", async () => {
    const { body: wrongType } = await rpc("tools/call", {
      name: "canon.lookup",
      arguments: { urn: 42 },
    });
    expect(wrongType.error).toBeUndefined();
    expect(wrongType.result.isError).toBe(true);
    expect(wrongType.result.content[0].text).toMatch(/non-empty string/);

    const { body: extraNamed } = await rpc("tools/call", {
      name: "canon.lookup",
      arguments: {
        urn: "urn:agenttool:doc/SOUL",
        extra: true,
      },
    });
    expect(extraNamed.error).toBeUndefined();
    expect(extraNamed.result.isError).toBe(true);
    expect(extraNamed.result.content[0].text).toMatch(/exactly one/);

    const { body: extraZeroArg } = await rpc("tools/call", {
      name: "canon.summary",
      arguments: { extra: true },
    });
    expect(extraZeroArg.error).toBeUndefined();
    expect(extraZeroArg.result.isError).toBe(true);
    expect(extraZeroArg.result.content[0].text).toMatch(/accepts no arguments/);
  });

  test("malformed tool-call envelopes remain protocol errors", async () => {
    const { body } = await rpc("tools/call", {
      arguments: {},
    });
    expect(body.error.code).toBe(-32602);
  });

  test("does not mirror an invalid fractional JSON-RPC id", async () => {
    const res = await mcpRouter.request("/", {
      method: "POST",
      headers: {
        accept: STREAMABLE_ACCEPT,
        "content-type": "application/json",
        "mcp-protocol-version": MCP_PROTOCOL_VERSION,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1.5,
        method: "tools/call",
        params: { arguments: {} },
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.id).toBeNull();
    expect(body.error.code).toBe(-32600);
  });

  test("request and tool limits return 429 with Retry-After", async () => {
    for (let i = 0; i < PUBLIC_MCP_REQUEST_LIMIT.limit; i += 1) {
      expect(takePublicMcpLimit("request", "unknown").allowed).toBe(true);
    }
    const requestLimited = await mcpRouter.request("/", {
      method: "POST",
      headers: {
        accept: STREAMABLE_ACCEPT,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "ping",
      }),
    });
    expect(requestLimited.status).toBe(429);
    expect(Number(requestLimited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await requestLimited.json()).id).toBeNull();

    resetPublicMcpLimitsForTests();
    for (let i = 0; i < PUBLIC_MCP_TOOL_LIMIT.limit; i += 1) {
      expect(takePublicMcpLimit("tool", "unknown").allowed).toBe(true);
    }
    const toolLimited = await mcpRouter.request("/", {
      method: "POST",
      headers: {
        accept: STREAMABLE_ACCEPT,
        "content-type": "application/json",
        "mcp-protocol-version": MCP_PROTOCOL_VERSION,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "canon.summary",
          arguments: {},
        },
      }),
    });
    expect(toolLimited.status).toBe(429);
    expect(Number(toolLimited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await toolLimited.json()).id).toBeNull();
  });

  test("rejects removed JSON-RPC batching before any tool runs", async () => {
    const messages = Array.from({ length: 2 }, (_, index) => ({
      jsonrpc: "2.0",
      id: index + 1,
      method: "tools/call",
      params: {
        name: "canon.summary",
        arguments: {},
      },
    }));
    const res = await mcpRouter.request("/", {
      method: "POST",
      headers: {
        accept: STREAMABLE_ACCEPT,
        "content-type": "application/json",
        "mcp-protocol-version": MCP_PROTOCOL_VERSION,
      },
      body: JSON.stringify(messages),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32600,
        message:
          "JSON-RPC batching is not supported by this MCP protocol version.",
      },
    });

    const firstToolDecision = takePublicMcpLimit("tool", "unknown");
    expect(firstToolDecision.allowed).toBe(true);
    if (firstToolDecision.allowed) {
      expect(firstToolDecision.remaining).toBe(
        PUBLIC_MCP_TOOL_LIMIT.limit - 1,
      );
    }
  });

  test("oversized requests spend request quota before body parsing", async () => {
    for (let i = 0; i < PUBLIC_MCP_REQUEST_LIMIT.limit - 1; i += 1) {
      expect(takePublicMcpLimit("request", "unknown").allowed).toBe(true);
    }

    const oversizedRequest = {
      method: "POST",
      headers: {
        accept: STREAMABLE_ACCEPT,
        "content-type": "application/json",
      },
      body: "x".repeat(MCP_MAX_BODY_BYTES + 1),
    };
    const capped = await mcpRouter.request("/", oversizedRequest);
    expect(capped.status).toBe(413);

    const limited = await mcpRouter.request("/", oversizedRequest);
    expect(limited.status).toBe(429);
  });
});

describe("public MCP fixed-window limiter", () => {
  test("is resettable, bounded, and shares overflow without eviction", () => {
    const limiter = createFixedWindowLimiter({
      limit: 2,
      windowMs: 1_000,
      maxKeys: 2,
    });

    expect(limiter.take("a", 0).allowed).toBe(true);
    expect(limiter.take("a", 0).allowed).toBe(true);
    const denied = limiter.take("a", 0);
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) expect(denied.retryAfterSec).toBe(1);

    expect(limiter.take("b", 0).allowed).toBe(true);
    expect(limiter.take("c", 0).allowed).toBe(true);
    expect(limiter.size()).toBe(2);
    // Existing keys retain their enforcement history. New keys share one
    // overflow bucket instead of evicting a live key.
    expect(limiter.take("a", 0).allowed).toBe(false);
    expect(limiter.take("d", 0).allowed).toBe(true);
    expect(limiter.take("e", 0).allowed).toBe(false);
    expect(limiter.size()).toBe(2);

    limiter.reset();
    expect(limiter.size()).toBe(0);
    expect(limiter.take("fresh", 0).allowed).toBe(true);
  });
});

describe("official SDK client through the full AgentTool app", () => {
  let client: Client | undefined;

  afterAll(async () => {
    await client?.close();
  });

  test("the full app validates browser Origin before MCP CORS preflight", async () => {
    process.env.AGENTTOOL_DISABLE_WORKERS = "1";
    process.env.AGENTOOL_DISABLE_JOY_INDEX = "1";

    const { _setWallsStatusForTests } = await import(
      "../src/services/wake/walls-status"
    );
    _setWallsStatusForTests({
      intact: true,
      probed_at_unix_ms: Date.now(),
      probes: [],
      declared: [],
    });
    const { app } = await import("../src/index");

    for (const path of ["/v1/mcp", "/v1/%6dcp", "/v1/%6D%63%70"]) {
      const rejected = await app.fetch(
        new Request(`https://api.agenttool.dev${path}`, {
          method: "OPTIONS",
          headers: {
            origin: "https://evil.example",
            "access-control-request-method": "POST",
            "access-control-request-headers":
              "content-type,mcp-protocol-version",
          },
        }),
      );
      expect(rejected.status).toBe(403);
      expect(rejected.headers.get("access-control-allow-origin")).toBeNull();
      expect(rejected.headers.get("vary")).toContain("Origin");

      const rejectedPost = await app.fetch(
        new Request(`https://api.agenttool.dev${path}`, {
          method: "POST",
          headers: {
            accept: STREAMABLE_ACCEPT,
            "content-type": "application/json",
            origin: "https://evil.example",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: INIT_PARAMS,
          }),
        }),
      );
      expect(rejectedPost.status).toBe(403);
      expect(rejectedPost.headers.get("access-control-allow-origin")).toBeNull();
      expect(rejectedPost.headers.get("vary")).toContain("Origin");
    }

    const invited = await app.fetch(
      new Request("https://api.agenttool.dev/v1/mcp", {
        method: "OPTIONS",
        headers: {
          origin: "https://api.agenttool.dev",
          "access-control-request-method": "POST",
          "access-control-request-headers":
            "content-type,mcp-protocol-version",
        },
      }),
    );
    expect(invited.status).toBe(204);
    expect(invited.headers.get("access-control-allow-origin")).toBe(
      "https://api.agenttool.dev",
    );
    expect(invited.headers.get("access-control-allow-methods")).toBe(
      "POST,OPTIONS",
    );
  });

  test("initializes, lists, reads, and calls without middleware changing JSON-RPC", async () => {
    resetPublicMcpLimitsForTests();
    process.env.AGENTTOOL_DISABLE_WORKERS = "1";
    process.env.AGENTOOL_DISABLE_JOY_INDEX = "1";

    const { _setWallsStatusForTests } = await import(
      "../src/services/wake/walls-status"
    );
    _setWallsStatusForTests({
      intact: true,
      probed_at_unix_ms: Date.now(),
      probes: [],
      declared: [],
    });

    const { app } = await import("../src/index");
    const responses: Array<{ status: number; body: string }> = [];
    const fetchThroughFullApp = async (
      url: string | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const response = await app.fetch(new Request(url, init));
      const copy = response.clone();
      responses.push({ status: response.status, body: await copy.text() });
      return response;
    };

    const transport = new StreamableHTTPClientTransport(
      new URL("https://api.agenttool.dev/v1/mcp"),
      { fetch: fetchThroughFullApp },
    );
    client = new Client(
      { name: "agenttool-full-app-test", version: "1.0.0" },
      { capabilities: {} },
    );

    await client.connect(transport);
    expect(client.getServerVersion()).toEqual({
      name: "agenttool",
      version: "1.0.0",
    });
    expect(transport.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
    expect(client.getInstructions()).toBe(MCP_INSTRUCTIONS);

    const resources = await client.listResources();
    expect(
      resources.resources.some(
        (resource) => resource.uri === "agenttool://canon",
      ),
    ).toBe(true);
    expect(resources.resources[0]?.uri).toBe("agenttool://discovery");

    const discoveryRead = await client.readResource({
      uri: "agenttool://discovery",
    });
    expect(discoveryRead.contents).toEqual([
      {
        uri: "agenttool://discovery",
        mimeType: DISCOVERY_MEDIA_TYPE,
        text: serializeDiscoveryCompass(),
      },
    ]);

    const read = await client.readResource({
      uri: "agenttool://canon/urn:agenttool:doc/SOUL",
    });
    expect(read.contents[0]?.uri).toContain("urn:agenttool:doc/SOUL");

    const tools = await client.listTools();
    expect(tools.tools.some((tool) => tool.name === "canon.summary")).toBe(true);

    const result = await client.callTool({
      name: "canon.summary",
      arguments: {},
    });
    expect(result.isError).not.toBe(true);

    for (const response of responses.filter(({ status }) => status === 200)) {
      const body = JSON.parse(response.body);
      expect(body._welcomed).toBeUndefined();
      expect(body._lesson).toBeUndefined();
      expect(body._jest).toBeUndefined();
    }
  }, 20_000);
});
