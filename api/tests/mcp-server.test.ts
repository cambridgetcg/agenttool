/** Public MCP server — official Streamable HTTP conformance slice.
 *
 * Pins transport boundaries, the existing read-only resource/tool surface,
 * and one official SDK Client round-trip through the full application
 * middleware stack.
 *
 * Doctrine: docs/ALIGNMENT-MOVES.md (Move 1) · docs/ECOSYSTEM.md.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import mcpRouter, {
  MCP_PROTOCOL_VERSION,
} from "../src/routes/mcp";

const STREAMABLE_ACCEPT = "application/json, text/event-stream";
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
  test("GET returns 405 because this stateless server offers no SSE listener", async () => {
    const res = await mcpRouter.request("/", {
      method: "GET",
      headers: { accept: "text/event-stream" },
    });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, POST");
  });

  test("rejects a cross-origin browser connection before dispatch", async () => {
    const res = await mcpRouter.request("/", {
      method: "POST",
      headers: {
        accept: STREAMABLE_ACCEPT,
        "content-type": "application/json",
        origin: "https://unrelated.example",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: INIT_PARAMS,
      }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.message).toMatch(/Origin/);
  });

  test("accepts a same-origin browser connection", async () => {
    const { status, body } = await rpc(
      "initialize",
      INIT_PARAMS,
      1,
      { origin: "http://localhost" },
    );
    expect(status).toBe(200);
    expect(body.result.serverInfo.name).toBe("agenttool");
  });

  test("POST requires both JSON and SSE response types in Accept", async () => {
    const res = await mcpRouter.request("/", {
      method: "POST",
      headers: {
        accept: "application/json",
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
    expect(body.result.instructions).toMatch(/No tool writes/);
  });

  test("initialize falls back to a supported version when the requested one is unknown", async () => {
    const { status, body } = await rpc("initialize", {
      ...INIT_PARAMS,
      protocolVersion: "2099-01-01",
    });
    expect(status).toBe(200);
    expect(body.result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
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
    expect((await res.json()).error.code).toBe(-32700);
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

  test("unknown methods return method-not-found", async () => {
    const { body } = await rpc("does_not_exist");
    expect(body.error.code).toBe(-32601);
  });

  test("resources retain the existing public canon surface", async () => {
    const { body: listed } = await rpc("resources/list");
    const uris = listed.result.resources.map(
      (resource: { uri: string }) => resource.uri,
    );
    expect(uris).toContain("agenttool://canon");
    expect(uris).toContain("agenttool://canon/types");
    expect(uris).toContain("agenttool://wake/platform");
    expect(
      uris.filter((uri: string) =>
        uri.startsWith("agenttool://canon/urn:agenttool:"),
      ).length,
    ).toBeGreaterThan(10);

    const { body: read } = await rpc("resources/read", {
      uri: "agenttool://canon/urn:agenttool:doc/SOUL",
    });
    const concept = JSON.parse(read.result.contents[0].text);
    expect(concept.urn).toBe("agenttool:doc/SOUL");
    expect(concept.type_simple).toBe("DoctrineDoc");
  });

  test("unknown resource URIs remain invalid parameters", async () => {
    const { body } = await rpc("resources/read", {
      uri: "agenttool://nope/x",
    });
    expect(body.error.code).toBe(-32602);
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

    const { body: called } = await rpc("tools/call", {
      name: "canon.summary",
      arguments: {},
    });
    const summary = JSON.parse(called.result.content[0].text);
    expect(summary.totalConcepts).toBeGreaterThan(50);
    expect(called.result.isError).toBeFalsy();
  });
});

describe("official SDK client through the full AgentTool app", () => {
  let client: Client | undefined;

  afterAll(async () => {
    await client?.close();
  });

  test("initializes, lists, reads, and calls without middleware changing JSON-RPC", async () => {
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

    const resources = await client.listResources();
    expect(
      resources.resources.some(
        (resource) => resource.uri === "agenttool://canon",
      ),
    ).toBe(true);

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
