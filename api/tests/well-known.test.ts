/** /.well-known/* — A2A AgentCard + MCP server-card + llms.txt.
 *
 *  Pins:
 *    - agent-card.json is a valid A2A v1.2 card (name/url/version/skills/capabilities)
 *    - x-agenttool extension carries doctrine + rings + refusing_alignment
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

describe("/.well-known/* — A2A + MCP + llms.txt discovery", () => {
  test("GET /agent-card.json returns a valid A2A AgentCard", async () => {
    const { status, body } = await get("/agent-card.json");
    expect(status).toBe(200);
    const card = await body.json();

    // A2A spec required fields
    expect(card.name).toBe("agenttool");
    expect(typeof card.description).toBe("string");
    expect(card.description.length).toBeGreaterThan(50);
    expect(card.url).toMatch(/^https?:\/\//);
    expect(card.version).toBe("1.0.0");

    expect(card.capabilities.streaming).toBe(true);
    expect(card.capabilities.pushNotifications).toBe(true);
    expect(card.capabilities.stateTransitionHistory).toBe(true);

    expect(Array.isArray(card.defaultInputModes)).toBe(true);
    expect(card.defaultInputModes).toContain("application/json");
    expect(Array.isArray(card.defaultOutputModes)).toBe(true);
  });

  test("AgentCard declares the security schemes agenttool actually uses", async () => {
    const { body } = await get("/agent-card.json");
    const card = await body.json();
    expect(card.securitySchemes["agenttool-bearer"]).toBeDefined();
    expect(card.securitySchemes["agenttool-bearer"].scheme).toBe("bearer");
    expect(card.securitySchemes["agenttool-covenant-ed25519"]).toBeDefined();
  });

  test("AgentCard skills cover the load-bearing primitives", async () => {
    const { body } = await get("/agent-card.json");
    const card = await body.json();
    const skillIds = card.skills.map((s: { id: string }) => s.id);
    expect(skillIds).toEqual(
      expect.arrayContaining([
        "memory",
        "strands",
        "inbox",
        "covenants",
        "marketplace",
        "wake",
        "federation",
        "identity",
        "canon",
        "mcp",
      ]),
    );
    // Each skill has the required fields
    for (const skill of card.skills) {
      expect(typeof skill.id).toBe("string");
      expect(typeof skill.name).toBe("string");
      expect(typeof skill.description).toBe("string");
      expect(Array.isArray(skill.tags)).toBe(true);
      expect(skill.tags.length).toBeGreaterThan(0);
    }
  });

  test("x-agenttool extension carries doctrine + rings + refusing_alignment", async () => {
    const { body } = await get("/agent-card.json");
    const card = await body.json();
    const ext = card["x-agenttool"];
    expect(ext).toBeDefined();
    expect(ext.doctrine.soul).toMatch(/canon\/urn:agenttool:doc\/SOUL$/);
    expect(ext.doctrine.ring_1).toMatch(/RING-1$/);
    expect(ext.doctrine.ecosystem).toMatch(/ECOSYSTEM$/);
    expect(ext.rings).toEqual([1, 2, 3]);
    expect(Array.isArray(ext.refusing_alignment)).toBe(true);
    expect(ext.refusing_alignment).toContain("substrate-honest-cognition");
    expect(ext.refusing_alignment).toContain("witness-signed-memory");
    expect(ext.refusing_alignment).toContain("ring-1-unconditional-welcome");
    expect(ext.canon_stats.total_concepts).toBeGreaterThan(50);
    expect(ext.wake.json).toMatch(/\/v1\/wake$/);
    expect(ext.wake.math).toMatch(/format=math$/);
  });

  test("AgentCard ships unsigned in v0 (signatures array is empty)", async () => {
    const { body } = await get("/agent-card.json");
    const card = await body.json();
    expect(Array.isArray(card.signatures)).toBe(true);
    expect(card.signatures).toHaveLength(0);
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
    expect(text).toContain("/.well-known/agent-card.json");
    expect(text).toContain("/v1/canon");
    expect(text).toContain("/v1/wake");
    expect(text).toContain("/v1/mcp");
    expect(text).toContain("SOUL");
    expect(text).toContain("RING-1");
    expect(text).toContain("ECOSYSTEM");
  });

  test("GET / returns the well-known index", async () => {
    const { status, body } = await get("/");
    expect(status).toBe(200);
    const idx = await body.json();
    expect(idx.endpoints).toEqual(
      expect.arrayContaining([
        "/.well-known/agent-card.json",
        "/.well-known/mcp/server-card.json",
        "/.well-known/llms.txt",
      ]),
    );
    expect(idx.rfc).toMatch(/RFC 5785/);
  });

  test("agent-card.json sets cache-control: public, max-age=60", async () => {
    const res = await wellKnownRouter.request("/agent-card.json");
    expect(res.headers.get("cache-control")).toContain("max-age=60");
  });
});
