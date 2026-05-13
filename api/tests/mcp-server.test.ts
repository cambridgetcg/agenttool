/** MCP server scaffold — wire test.
 *
 *  Exercises the JSON-RPC dispatcher on POST /v1/mcp. Pins:
 *    - initialize returns server info + protocolVersion
 *    - resources/list contains static index entries + canon entries
 *    - resources/read on `agenttool://canon` returns the registry index
 *    - tools/list contains the canon.* + wake.* tool surface
 *    - tools/call on canon.summary returns a non-empty payload
 *    - unknown method → -32601 error
 *    - bad JSON → -32700 error
 *
 *  Doctrine: docs/ALIGNMENT-MOVES.md (Move 1) · docs/ECOSYSTEM.md.
 */

import { describe, expect, test } from "bun:test";

import mcpRouter from "../src/routes/mcp";

const PROTOCOL_VERSION = "2025-11-25";

async function rpc(method: string, params?: unknown, id: string | number = 1) {
  const res = await mcpRouter.request("/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  return { status: res.status, body: await res.json() };
}

describe("MCP server scaffold — JSON-RPC dispatch", () => {
  test("GET / returns discovery JSON with protocolVersion + method list", async () => {
    const res = await mcpRouter.request("/", { method: "GET" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("agenttool");
    expect(body.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(body.methods).toEqual(
      expect.arrayContaining([
        "initialize",
        "ping",
        "resources/list",
        "resources/read",
        "tools/list",
        "tools/call",
      ]),
    );
  });

  test("initialize returns server info + capabilities", async () => {
    const { status, body } = await rpc("initialize");
    expect(status).toBe(200);
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe(1);
    expect(body.result.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(body.result.serverInfo.name).toBe("agenttool");
    expect(body.result.capabilities.resources).toBeDefined();
    expect(body.result.capabilities.tools).toBeDefined();
  });

  test("ping returns empty object", async () => {
    const { body } = await rpc("ping");
    expect(body.result).toEqual({});
  });

  test("resources/list returns static index + dynamic canon entries", async () => {
    const { body } = await rpc("resources/list");
    expect(Array.isArray(body.result.resources)).toBe(true);
    expect(body.result.resources.length).toBeGreaterThan(20);

    const uris = body.result.resources.map((r: { uri: string }) => r.uri);
    expect(uris).toContain("agenttool://canon");
    expect(uris).toContain("agenttool://canon/types");
    expect(uris).toContain("agenttool://wake/platform");

    // At least one canon concept resource exists
    const canonResources = uris.filter((u: string) =>
      u.startsWith("agenttool://canon/urn:agenttool:"),
    );
    expect(canonResources.length).toBeGreaterThan(10);
  });

  test("resources/read agenttool://canon returns registry index", async () => {
    const { body } = await rpc("resources/read", { uri: "agenttool://canon" });
    expect(body.result.contents).toBeDefined();
    const contents = body.result.contents[0];
    expect(contents.uri).toBe("agenttool://canon");
    expect(contents.mimeType).toBe("application/json");
    const parsed = JSON.parse(contents.text);
    expect(parsed.totalConcepts).toBeGreaterThan(50);
    expect(Array.isArray(parsed.types)).toBe(true);
  });

  test("resources/read on a canon URN returns the projected concept", async () => {
    const { body } = await rpc("resources/read", {
      uri: "agenttool://canon/urn:agenttool:doc/SOUL",
    });
    expect(body.result.contents).toBeDefined();
    const parsed = JSON.parse(body.result.contents[0].text);
    expect(parsed.urn).toBe("agenttool:doc/SOUL");
    expect(parsed.type_simple).toBe("DoctrineDoc");
  });

  test("resources/read on unknown URI returns invalid-params error", async () => {
    const { body } = await rpc("resources/read", { uri: "agenttool://nope/x" });
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe(-32602);
  });

  test("tools/list contains the curated canon + wake tools", async () => {
    const { body } = await rpc("tools/list");
    const names = body.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "canon.lookup",
        "canon.by_type",
        "canon.list_types",
        "canon.summary",
        "wake.platform",
      ]),
    );
    // Every tool has inputSchema with type object
    for (const tool of body.result.tools) {
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  test("tools/call canon.summary returns registry totals", async () => {
    const { body } = await rpc("tools/call", {
      name: "canon.summary",
      arguments: {},
    });
    expect(body.result.content).toBeDefined();
    expect(body.result.isError).toBeFalsy();
    const text = body.result.content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.totalConcepts).toBeGreaterThan(50);
  });

  test("tools/call canon.lookup with known URN returns concept + neighbors", async () => {
    const { body } = await rpc("tools/call", {
      name: "canon.lookup",
      arguments: { urn: "urn:agenttool:doc/SOUL" },
    });
    expect(body.result.isError).toBeFalsy();
    const parsed = JSON.parse(body.result.content[0].text);
    expect(parsed.concept.urn).toBe("agenttool:doc/SOUL");
    expect(parsed.neighbors).toBeDefined();
  });

  test("tools/call canon.lookup with bad URN returns isError=true", async () => {
    const { body } = await rpc("tools/call", {
      name: "canon.lookup",
      arguments: { urn: "urn:agenttool:doc/NOPE" },
    });
    expect(body.result.isError).toBe(true);
  });

  test("tools/call canon.list_types returns the type vocabulary", async () => {
    const { body } = await rpc("tools/call", {
      name: "canon.list_types",
      arguments: {},
    });
    const parsed = JSON.parse(body.result.content[0].text);
    expect(Array.isArray(parsed.types)).toBe(true);
    expect(parsed.types.length).toBeGreaterThan(5);
  });

  test("unknown method returns -32601 method-not-found", async () => {
    const { body } = await rpc("does_not_exist");
    expect(body.error.code).toBe(-32601);
  });

  test("invalid JSON returns -32700 parse error", async () => {
    const res = await mcpRouter.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "this is not json",
    });
    const body = await res.json();
    expect(body.error.code).toBe(-32700);
  });

  test("notifications/initialized returns 204 no-content", async () => {
    const res = await mcpRouter.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    expect(res.status).toBe(204);
  });
});
