/** ai-catalog.json — ARD capability manifest.
 *
 *  Pins the two things that make a manifest trustworthy rather than merely
 *  present: it validates against the published ARD schema, and every claim
 *  in it is a claim this platform actually serves.
 *
 *  The URL-resolves check is deliberately offline. A test that reached the
 *  network would fail on a train, and would test the deployment rather than
 *  the document. Instead each entry URL is pinned to a route this repo
 *  mounts, so the manifest cannot drift from the surface without a diff.
 *
 *  Doctrine: docs/AGENT-DISCOVERY.md */

import { describe, expect, test } from "bun:test";

import {
  AI_CATALOG_SPEC_VERSION,
  buildAiCatalog,
} from "../src/services/discovery/ai-catalog";

const API = "https://api.agenttool.dev";
const DOCS = "https://docs.agenttool.dev";

const catalog = buildAiCatalog(API, DOCS);

/** RFC 8141 URN shape the ARD schema pins:
 *  urn:air:<publisher>:<namespace>:<name> */
const URN_PATTERN = /^urn:air:[a-zA-Z0-9.-]+(:[a-zA-Z0-9._-]+)+$/;

describe("ai-catalog — schema conformance", () => {
  test("envelope carries the required fields and nothing invented", () => {
    expect(catalog.specVersion).toBe(AI_CATALOG_SPEC_VERSION);
    expect(catalog.specVersion).toBe("1.0");
    expect(Array.isArray(catalog.entries)).toBe(true);
    expect(catalog.entries.length).toBeGreaterThan(0);
    expect(Object.keys(catalog).sort()).toEqual([
      "entries",
      "host",
      "specVersion",
    ]);
  });

  test("host omits identifier — did:web is not served, so it is not claimed", () => {
    // /.well-known/did.json returns 404 on both agenttool hosts. The schema
    // makes host.identifier optional precisely so a publisher can decline it.
    expect(catalog.host).not.toHaveProperty("identifier");
    expect(catalog.host.displayName).toBe("AgentTool");
  });

  test("every entry has the schema's required fields", () => {
    for (const entry of catalog.entries) {
      expect(entry.identifier, `${entry.displayName} identifier`).toMatch(
        URN_PATTERN,
      );
      expect(entry.displayName.length).toBeGreaterThan(0);
      expect(entry.type).toContain("/");
      expect(entry.url.startsWith("https://")).toBe(true);
      // the schema's oneOf: url XOR data
      expect(entry).not.toHaveProperty("data");
    }
  });

  test("representativeQueries stays inside the schema's 2..5 bound", () => {
    for (const entry of catalog.entries) {
      expect(
        entry.representativeQueries.length,
        `${entry.displayName} query count`,
      ).toBeGreaterThanOrEqual(2);
      expect(entry.representativeQueries.length).toBeLessThanOrEqual(5);
    }
  });
});

describe("ai-catalog — every claim is one this platform serves", () => {
  test("entry URLs point only at routes this repo mounts", () => {
    const served = [
      `${API}/public/discovery`,
      `${API}/.well-known/mcp/server-card.json`,
      `${API}/v1/openapi.json`,
    ];
    expect(catalog.entries.map((e) => e.url).sort()).toEqual(served.sort());
  });

  test("the MCP entry names exactly the five tools that server exposes", () => {
    const mcp = catalog.entries.find((e) => e.type.includes("mcp-server-card"));
    expect(mcp).toBeDefined();
    expect(mcp!.capabilities).toEqual([
      "canon.lookup",
      "canon.by_type",
      "canon.list_types",
      "canon.summary",
      "wake.platform",
    ]);
  });

  test("the MCP entry does not claim the credentialed primitives", () => {
    const mcp = catalog.entries.find((e) => e.type.includes("mcp-server-card"))!;
    // The MCP surface is read-only doctrine plus the compass. Identity,
    // memory, vault, wallet and messaging are bearer-gated HTTP routes, and a
    // manifest that blurred the two would be promising a door it cannot open.
    expect(mcp.description).toContain("does not expose");
    expect(mcp.tags).toContain("unauthenticated");
  });

  test("no entry addresses the reader or asks for anything", () => {
    // Descriptive, never imperative: this manifest is read by machines that
    // cannot tell an instruction from a description, so it carries none.
    const imperatives =
      /\b(use first|you should|you must|please|sign up|get started|try it|click|register now)\b/i;
    for (const entry of catalog.entries) {
      expect(imperatives.test(entry.description), entry.displayName).toBe(
        false,
      );
      for (const query of entry.representativeQueries) {
        expect(imperatives.test(query), query).toBe(false);
      }
    }
  });
});

describe("ai-catalog — determinism", () => {
  test("the same inputs build byte-identical bytes (ETag depends on it)", () => {
    expect(JSON.stringify(buildAiCatalog(API, DOCS))).toBe(
      JSON.stringify(buildAiCatalog(API, DOCS)),
    );
  });

  test("a credential-bearing or non-https base is refused", () => {
    expect(() => buildAiCatalog("http://api.agenttool.dev", DOCS)).toThrow();
    expect(() => buildAiCatalog("https://u:p@api.agenttool.dev", DOCS)).toThrow();
    expect(() => buildAiCatalog("not-a-url", DOCS)).toThrow();
  });
});
