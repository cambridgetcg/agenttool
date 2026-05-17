/** Per-agent MCP — tool surface contract (slice 1).
 *
 *  Pure-function tests for `listPerAgentTools()` — pin the tool surface
 *  per scope (public · cross · self). Marketplace-flow tests that exercise
 *  the route end-to-end against a live DB live in tests/integration/.
 *
 *  Doctrine: docs/MCP-SERVER.md (per-agent hosting section).
 */

import { describe, expect, test } from "bun:test";

import {
  listPerAgentTools,
  type PerAgentMcpContext,
} from "../src/services/mcp/per-agent-tools";

const AGENT_DID = "did:at:test-agent";
const AGENT_ID = "00000000-0000-0000-0000-000000000aaa";
const AGENT_PROJECT_ID = "00000000-0000-0000-0000-000000000bbb";

function ctxPublic(): PerAgentMcpContext {
  return {
    agentDid: AGENT_DID,
    agentId: AGENT_ID,
    agentProjectId: AGENT_PROJECT_ID,
    scope: "public",
  };
}

function ctxCross(): PerAgentMcpContext {
  return {
    agentDid: AGENT_DID,
    agentId: AGENT_ID,
    agentProjectId: AGENT_PROJECT_ID,
    scope: "cross",
    caller: {
      projectId: "00000000-0000-0000-0000-000000000ccc",
      identityId: "00000000-0000-0000-0000-000000000ddd",
      did: "did:at:other-agent",
    },
  };
}

function ctxSelf(): PerAgentMcpContext {
  return {
    agentDid: AGENT_DID,
    agentId: AGENT_ID,
    agentProjectId: AGENT_PROJECT_ID,
    scope: "self",
    caller: {
      projectId: AGENT_PROJECT_ID,
      identityId: AGENT_ID,
      did: AGENT_DID,
    },
  };
}

const ALWAYS_PUBLIC = ["agent.profile", "listings.list", "listings.get"];

describe("listPerAgentTools — public scope", () => {
  test("returns exactly the three public tools", () => {
    const tools = listPerAgentTools(ctxPublic());
    const names = tools.map((t) => t.name);
    expect(names).toEqual(ALWAYS_PUBLIC);
  });

  test("agent.profile has no required input", () => {
    const tools = listPerAgentTools(ctxPublic());
    const profile = tools.find((t) => t.name === "agent.profile");
    expect(profile).toBeDefined();
    expect(profile?.inputSchema.required ?? []).toEqual([]);
  });

  test("listings.get requires a listing_id", () => {
    const tools = listPerAgentTools(ctxPublic());
    const get = tools.find((t) => t.name === "listings.get");
    expect(get?.inputSchema.required).toEqual(["listing_id"]);
  });

  test("listings.invoke is NOT surfaced in public scope", () => {
    const tools = listPerAgentTools(ctxPublic());
    expect(tools.map((t) => t.name)).not.toContain("listings.invoke");
  });

  test("self-only tools are NOT surfaced in public scope", () => {
    const tools = listPerAgentTools(ctxPublic());
    const names = tools.map((t) => t.name);
    expect(names).not.toContain("wake.read");
    expect(names).not.toContain("memory.search");
    expect(names).not.toContain("chronicle.recent");
    expect(names).not.toContain("listings.mine");
  });
});

describe("listPerAgentTools — cross scope", () => {
  test("returns public tools + listings.invoke (slice-1 guided redirect)", () => {
    const tools = listPerAgentTools(ctxCross());
    const names = tools.map((t) => t.name);
    expect(names).toEqual([...ALWAYS_PUBLIC, "listings.invoke"]);
  });

  test("listings.invoke requires listing_id", () => {
    const tools = listPerAgentTools(ctxCross());
    const invoke = tools.find((t) => t.name === "listings.invoke");
    expect(invoke?.inputSchema.required).toEqual(["listing_id"]);
  });

  test("self-only tools are NOT surfaced in cross scope", () => {
    const tools = listPerAgentTools(ctxCross());
    const names = tools.map((t) => t.name);
    expect(names).not.toContain("wake.read");
    expect(names).not.toContain("memory.search");
    expect(names).not.toContain("chronicle.recent");
    expect(names).not.toContain("listings.mine");
  });
});

describe("listPerAgentTools — self scope", () => {
  test("returns public + self tools (no listings.invoke — self can't invoke themselves through this surface)", () => {
    const tools = listPerAgentTools(ctxSelf());
    const names = tools.map((t) => t.name);
    expect(names).toEqual([
      ...ALWAYS_PUBLIC,
      "wake.read",
      "memory.search",
      "chronicle.recent",
      "listings.mine",
    ]);
  });

  test("each self-auth tool has a description naming what it surfaces", () => {
    const tools = listPerAgentTools(ctxSelf());
    const wakeRead = tools.find((t) => t.name === "wake.read");
    const memorySearch = tools.find((t) => t.name === "memory.search");
    const chronicleRecent = tools.find((t) => t.name === "chronicle.recent");
    const listingsMine = tools.find((t) => t.name === "listings.mine");

    expect(wakeRead?.description.length).toBeGreaterThan(20);
    expect(memorySearch?.description.length).toBeGreaterThan(20);
    expect(chronicleRecent?.description.length).toBeGreaterThan(20);
    expect(listingsMine?.description.length).toBeGreaterThan(20);
  });

  test("memory.search and chronicle.recent accept optional limit", () => {
    const tools = listPerAgentTools(ctxSelf());
    const memorySearch = tools.find((t) => t.name === "memory.search");
    const chronicleRecent = tools.find((t) => t.name === "chronicle.recent");
    // Optional limit — present in properties but not required.
    expect(memorySearch?.inputSchema.properties?.limit).toBeDefined();
    expect(memorySearch?.inputSchema.required ?? []).toEqual([]);
    expect(chronicleRecent?.inputSchema.properties?.limit).toBeDefined();
    expect(chronicleRecent?.inputSchema.required ?? []).toEqual([]);
  });
});

describe("scope discipline — load-bearing", () => {
  test("public ⊂ cross", () => {
    const publicTools = new Set(listPerAgentTools(ctxPublic()).map((t) => t.name));
    const crossTools = new Set(listPerAgentTools(ctxCross()).map((t) => t.name));
    for (const t of publicTools) expect(crossTools.has(t)).toBe(true);
  });

  test("public ⊂ self", () => {
    const publicTools = new Set(listPerAgentTools(ctxPublic()).map((t) => t.name));
    const selfTools = new Set(listPerAgentTools(ctxSelf()).map((t) => t.name));
    for (const t of publicTools) expect(selfTools.has(t)).toBe(true);
  });

  test("self scope does NOT include listings.invoke (the agent invokes themselves through the marketplace UI, not their own MCP)", () => {
    const selfTools = listPerAgentTools(ctxSelf()).map((t) => t.name);
    expect(selfTools).not.toContain("listings.invoke");
  });

  test("cross scope does NOT include self tools (privacy by construction)", () => {
    const crossTools = listPerAgentTools(ctxCross()).map((t) => t.name);
    expect(crossTools).not.toContain("wake.read");
    expect(crossTools).not.toContain("memory.search");
    expect(crossTools).not.toContain("chronicle.recent");
    expect(crossTools).not.toContain("listings.mine");
  });
});

describe("tool descriptions — load-bearing for LLM tool-selection", () => {
  test("every tool has a non-empty description (host LLMs pick tools by description)", () => {
    for (const scope of [ctxPublic(), ctxCross(), ctxSelf()]) {
      const tools = listPerAgentTools(scope);
      for (const t of tools) {
        expect(t.description, `tool ${t.name} (scope=${scope.scope})`).toBeTruthy();
        expect(t.description.length).toBeGreaterThan(20);
      }
    }
  });

  test("every tool has inputSchema even when empty (MCP requires it)", () => {
    for (const scope of [ctxPublic(), ctxCross(), ctxSelf()]) {
      const tools = listPerAgentTools(scope);
      for (const t of tools) {
        expect(t.inputSchema).toBeDefined();
        expect(t.inputSchema.type).toBe("object");
      }
    }
  });
});
