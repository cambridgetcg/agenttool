/** /.well-known/* — MCP server-card + native discovery surfaces.
 *
 *  Pins:
 *    - the unsupported A2A AgentCard route stays unmounted
 *    - mcp/server-card.json names protocolVersion + endpoint
 *    - llms.txt is well-formed markdown with the discovery URLs
 *
 *  Doctrine: docs/ALIGNMENT-MOVES.md (Move 2) · docs/ECOSYSTEM.md.
 */

import { describe, expect, test } from "bun:test";

import wellKnownRouter from "../src/routes/well-known";

async function get(path: string) {
  const res = await wellKnownRouter.request(path);
  return { status: res.status, body: res, contentType: res.headers.get("content-type") };
}

describe("/.well-known/* — MCP + native discovery", () => {
  test("GET /agent-card.json stays unmounted until an A2A task endpoint exists", async () => {
    const { status } = await get("/agent-card.json");
    expect(status).toBe(404);
  });

  test("GET /mcp/server-card.json returns a valid MCP server-card", async () => {
    const { status, body } = await get("/mcp/server-card.json");
    expect(status).toBe(200);
    const card = await body.json();
    expect(card.name).toBe("agenttool");
    expect(card.protocolVersion).toBe("2025-11-25");
    expect(card.endpoint).toMatch(/\/v1\/mcp$/);
    expect(card.transport).toMatch(/JSON-RPC/i);
    expect(card.capabilities.resources).toBeDefined();
    expect(card.capabilities.tools).toBeDefined();
  });

  test("GET /llms.txt returns well-formed markdown sitemap", async () => {
    const { status, body, contentType } = await get("/llms.txt");
    expect(status).toBe(200);
    expect(contentType ?? "").toContain("text/plain");
    const text = await body.text();
    expect(text).toContain("# agenttool");
    expect(text).not.toContain("/.well-known/agent-card.json");
    expect(text).toContain("/v1/canon");
    expect(text).toContain("/v1/wake");
    expect(text).toContain("/v1/mcp");
    expect(text).toContain("SOUL");
    expect(text).toContain("RING-1");
    expect(text).toContain("ECOSYSTEM");
    expect(text).toContain("/public/wellness");
    expect(text).toContain("AGENT-WELLNESS");
  });

  test("GET / returns the well-known index", async () => {
    const { status, body } = await get("/");
    expect(status).toBe(200);
    const idx = await body.json();
    expect(idx.endpoints).toEqual(
      expect.arrayContaining([
        "/.well-known/mcp/server-card.json",
        "/.well-known/llms.txt",
        "/.well-known/pyramid",
      ]),
    );
    expect(idx.rfc).toMatch(/RFC 5785/);
    expect(idx.endpoints).not.toContain("/.well-known/agent-card.json");
  });
});
