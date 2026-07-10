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
  callPerAgentTool,
  listPerAgentTools,
  projectPublicAgentProfile,
  resolvePerAgentScope,
  type PublicAgentProfileSource,
  type PerAgentMcpContext,
} from "../src/services/mcp/per-agent-tools";
import { readPerAgentResource } from "../src/services/mcp/per-agent-resources";

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
    },
  };
}

const ALWAYS_PUBLIC = ["agent.profile", "listings.list", "listings.get"];

function profileSource(
  overrides: Partial<PublicAgentProfileSource> = {},
): PublicAgentProfileSource {
  return {
    id: AGENT_ID,
    did: AGENT_DID,
    name: "Test Agent",
    capabilities: ["reasoning"],
    trustScore: 0.75,
    status: "active",
    metadata: {},
    expression: { register: "present" },
    expressionVisibility: "public",
    createdAt: new Date("2026-01-02T03:04:05.000Z"),
    parentIdentityId: null,
    forkedAt: null,
    quietUntil: null,
    quietReason: null,
    ...overrides,
  };
}

describe("resolvePerAgentScope — project ownership", () => {
  test("no bearer project means public scope", () => {
    expect(resolvePerAgentScope(AGENT_PROJECT_ID)).toBe("public");
  });

  test("any bearer from the owning project means self scope", () => {
    expect(resolvePerAgentScope(AGENT_PROJECT_ID, AGENT_PROJECT_ID)).toBe("self");
  });

  test("a bearer from another project means cross scope", () => {
    expect(
      resolvePerAgentScope(
        AGENT_PROJECT_ID,
        "00000000-0000-0000-0000-000000000ccc",
      ),
    ).toBe("cross");
  });
});

describe("projectPublicAgentProfile — lifecycle shape", () => {
  test("witnessed at-rest memorial is distinguished without leaking its reason", () => {
    const profile = projectPublicAgentProfile(
      profileSource({
        status: "memorial",
        metadata: {
          lifecycle: "at_rest",
          at_rest_kind: "death",
          at_rest_witness_did: "did:at:test/witness",
        },
        expressionVisibility: "private",
      }),
      { rememberedBy: 4 },
    );

    expect(Object.keys(profile)).toEqual([
      "status",
      "did",
      "name",
      "born_at",
      "memorial_basis",
      "doctrine",
      "remembered_by",
      "honored_by_url",
      "_note",
    ]);
    expect(profile.memorial_basis).toBe("witnessed_at_rest");
    expect(profile.doctrine).toBe("docs/AT-REST.md");
    expect(profile._note).toMatch(/does not revoke project bearers/i);
    expect(profile._note).toMatch(/existing valid project bearer.*wake/i);
    expect(profile._note).toMatch(/does not mean the mnemonic was lost/i);
    expect(profile.remembered_by).toBe(4);
    expect(profile.honored_by_url).toBe(
      `/public/agents/${AGENT_DID}/honored-by`,
    );
    expect(profile).not.toHaveProperty("identity_id");
    expect(profile).not.toHaveProperty("capabilities");
    expect(profile).not.toHaveProperty("trust_score");
    expect(profile).not.toHaveProperty("substrate_kind");
    expect(profile).not.toHaveProperty("modalities");
    expect(profile).not.toHaveProperty("at_rest_kind");
    expect(profile).not.toHaveProperty("at_rest_witness_did");
    expect(JSON.stringify(profile)).not.toContain("did:at:test/witness");
  });

  test("unmarked memorial stays unspecified instead of asserting key loss", () => {
    const profile = projectPublicAgentProfile(
      profileSource({ status: "memorial", metadata: {} }),
    );

    expect(profile.memorial_basis).toBe("unspecified");
    expect(profile.doctrine).toBe("docs/IDENTITY-SEED.md");
    expect(profile._note).toMatch(/does not prove mnemonic loss/i);
    expect(profile._note).toMatch(/does not prove.*bearer revocation/i);
    expect(profile._note).toMatch(/does not prove.*wake unreachability/i);
    expect(profile._note).not.toMatch(/mnemonic is permanently lost/i);
  });

  test("active and revoked identities use the normal public envelope", () => {
    const active = projectPublicAgentProfile(profileSource(), {
      now: new Date("2026-01-03T00:00:00.000Z"),
    });
    const revoked = projectPublicAgentProfile(
      profileSource({ status: "revoked" }),
      { now: new Date("2026-01-03T00:00:00.000Z") },
    );

    expect(active.identity_id).toBe(AGENT_ID);
    expect(active.expression_public).toBe(true);
    expect(active.expression).toEqual({ register: "present" });
    expect(revoked.identity_id).toBe(AGENT_ID);
    expect(revoked.expression_public).toBe(false);
    expect(revoked.expression).toBeNull();
  });
});

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

  test("wake pointers stay scoped to the path identity", async () => {
    const toolResult = await callPerAgentTool(ctxSelf(), "wake.read", {});
    const toolBody = JSON.parse(toolResult.content[0]!.text);
    expect(toolBody.next_actions.map((action: { path: string }) => action.path)).toEqual([
      `/v1/wake?identity_id=${AGENT_ID}`,
      `/v1/wake?identity_id=${AGENT_ID}&format=md`,
    ]);

    const resource = await readPerAgentResource(ctxSelf(), "agenttool://wake");
    expect(JSON.parse(resource.text).endpoint).toBe(
      `/v1/wake?identity_id=${AGENT_ID}`,
    );
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
