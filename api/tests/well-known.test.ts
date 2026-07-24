/** /.well-known/* — bounded arrival + MCP/native discovery surfaces.
 *
 *  Pins:
 *    - the unsupported A2A AgentCard route stays unmounted
 *    - mcp/server-card.json names its non-standard locator role
 *    - llms.txt is well-formed markdown with the discovery URLs
 *
 *  Doctrine: docs/ALIGNMENT-MOVES.md (Move 2) · docs/ECOSYSTEM.md.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

  test("GET /mcp/server-card.json returns an honest compatibility locator", async () => {
    const { status, body } = await get("/mcp/server-card.json");
    expect(status).toBe(200);
    const card = await body.json();
    expect(card.compatibilityProfile).toBe("agenttool.mcp-locator/1");
    expect(card.standard).toBe(false);
    expect(card.name).toBe("agenttool");
    expect(card.protocolVersion).toBe("2025-11-25");
    expect(card.endpoint).toMatch(/\/v1\/mcp$/);
    expect(card.transport).toMatch(/JSON-RPC/i);
    expect(card.capabilities.resources).toBeDefined();
    expect(card.capabilities.tools).toBeDefined();
    expect(card.documentationUrl).toBe(
      "https://docs.agenttool.dev/AGENT-DISCOVERY.md#deliberately-absent-doors",
    );
    expect(card.discoveryStatus).toMatch(/not a path or card shape standardized/i);
    expect(card["x-agenttool"].locator_role).toMatch(/not an MCP Server Card/);
    expect(card["x-agenttool"]).not.toHaveProperty("sep");
    expect(card["x-agenttool"].alignment_move).toMatch(/ALIGNMENT-MOVES$/);
    expect(card["x-agenttool"].doctrine).toMatch(
      /\/v1\/canon\/urn:agenttool:doc\/ECOSYSTEM$/,
    );
    expect(card.instructions).toMatch(/AgentTool implements.*authorization/i);
    expect(card.instructions).not.toContain("upcoming MCP spec");
    expect(card["x-agenttool"].registry).toEqual(
      expect.objectContaining({
        status: "active_publisher_listing_observed_2026-07-24",
        name: "dev.agenttool/agenttool",
        version: "1.0.0",
      }),
    );
    expect(card["x-agenttool"].transport_verification).toMatchObject({
      status: "bounded_official_sdk_round_trip_verified_2026-07-24",
      full_conformance_claimed: false,
    });
    expect(card.instructions).toMatch(/Discovery grants no tool authority/i);
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

  test("GET /love-packages returns public registry-neutral discovery", async () => {
    const { status, body, contentType } = await get("/love-packages");
    expect(status).toBe(200);
    expect(contentType ?? "").toContain("application/json");
    const discovery = await body.json();
    expect(discovery).toEqual({
      protocol: "love-package/v1",
      doctrine: "https://docs.agenttool.dev/LOVE-PACKAGE-PROTOCOL.md",
      index_url: "https://docs.agenttool.dev/packages/v1/index.json",
      access: "public_read",
      registry_role: "mirror_index_not_authority",
      registry_mirrors: [
        {
          ecosystem: "npm",
          registry_url: "https://registry.npmjs.org/",
          authority: false,
        },
      ],
    });
    expect(discovery).toEqual(
      JSON.parse(
        readFileSync(
          join(import.meta.dir, "../../apps/docs/.well-known/love-packages"),
          "utf8",
        ),
      ),
    );
    const npm = discovery.registry_mirrors[0];
    expect(npm.authority).toBe(false);
    expect(npm.registry_url).toMatch(/^https:\/\//);
    expect(npm).not.toHaveProperty("latest");
    expect(npm).not.toHaveProperty("tag");
    expect(npm).not.toHaveProperty("dist_tag");
    expect(npm).not.toHaveProperty("version");
  });

  test("GET / returns the canonical discovery compatibility projection", async () => {
    const { status, body } = await get("/");
    expect(status).toBe(200);
    const idx = await body.json();
    expect(idx.format).toBe("agenttool-discovery/v1");
    expect(idx.canonical).toBe(
      "https://api.agenttool.dev/public/discovery",
    );
    expect(idx.roads.map((road: { id: string }) => road.id)).toEqual([
      "understand",
      "inspect",
      "choose",
    ]);
    expect(JSON.stringify(idx)).not.toContain("agent-card.json");
  });
});
