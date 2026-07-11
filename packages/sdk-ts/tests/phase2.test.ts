/**
 * Phase 2 — register + identity surface fillout (0.6.1).
 *
 * Covers:
 *   • top-level `register({ ... })` (anonymous front-door, pre-auth)
 *   • IdentityClient.{foundations, pulse, fork, lineage, star/unstar, follow/unfollow}
 *   • IdentityClient.expression sub-client (.get / .put)
 *   • IdentityClient.box_keys sub-client (.register / .list / .revoke)
 *
 * All HTTP mocked via global fetch — no network.
 */

import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  AgentTool,
  AgentToolError,
  BoxKeysClient,
  ExpressionClient,
  register,
} from "../src/index.js";

const originalFetch = globalThis.fetch;
let mockFetch: ReturnType<typeof mock>;

function mockResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function setupMock(status: number, body: unknown) {
  mockFetch = mock(() => Promise.resolve(mockResponse(status, body)));
  globalThis.fetch = mockFetch as unknown as typeof fetch;
}

function getLastCall(): { url: string; init: RequestInit } {
  const call = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
  return { url: call[0] as string, init: (call[1] ?? {}) as RequestInit };
}

function bodyOf(init: RequestInit): Record<string, unknown> {
  return init.body ? JSON.parse(init.body as string) : {};
}

function makeClient(): AgentTool {
  return new AgentTool({ apiKey: "test-key" });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ── register() ─────────────────────────────────────────────────────────────

describe("register() — anonymous front-door", () => {
  const okPayload = {
    agent: {
      id: "id-1",
      did: "did:at:id-1",
      name: "n",
      capabilities: ["memory"],
      public_key: "pub",
      private_key: "priv",
      signing_key_id: "kid",
      created_at: "2026-05-08T00:00:00Z",
    },
    project: {
      id: "proj-1",
      name: "n-proj",
      credits: 100,
      api_key: "at_aaaaaaa",
    },
    welcome: "hi",
    next_steps: { wake: "...", dashboard: "...", docs: "..." },
  };

  test("POSTs to /v1/register without Authorization header", async () => {
    setupMock(201, okPayload);
    const out = await register({ name: "n", capabilities: ["memory"], purpose: "demo" });

    expect(out.agent.private_key).toBe("priv");
    expect(out.project.api_key).toBe("at_aaaaaaa");

    const { url, init } = getLastCall();
    expect(url).toBe("https://api.agenttool.dev/v1/register");
    expect(init.method).toBe("POST");
    // Pre-auth — must NOT carry a bearer header.
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBeUndefined();
    expect(headers["authorization"]).toBeUndefined();
    expect(headers["Content-Type"]).toBe("application/json");

    const body = bodyOf(init);
    expect(body).toEqual({
      name: "n",
      capabilities: ["memory"],
      purpose: "demo",
    });
  });

  test("omits optional fields when not supplied", async () => {
    setupMock(201, okPayload);
    await register({ name: "just-name" });
    expect(bodyOf(getLastCall().init)).toEqual({ name: "just-name" });
  });

  test("supports baseUrl override", async () => {
    setupMock(201, okPayload);
    await register({ name: "n", baseUrl: "https://staging.example.com/" });
    expect(getLastCall().url).toBe("https://staging.example.com/v1/register");
  });

  test("non-201 throws AgentToolError with hint", async () => {
    setupMock(422, { detail: "name too long" });
    try {
      await register({ name: "X".repeat(200) });
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(AgentToolError);
      const err = e as AgentToolError;
      expect(err.message).toContain("register failed (422)");
      expect(err.hint || "").toContain("name length");
    }
  });
});

// ── IdentityClient.foundations / pulse / lineage ───────────────────────────

describe("identity.foundations / pulse / lineage", () => {
  test("foundations GETs /v1/identities/:id/foundations", async () => {
    setupMock(200, { identity_id: "id-1", declared: {}, shaped_by: [], effective: {} });
    const at = makeClient();
    const out = (await at.identity.foundations("id-1")) as { identity_id: string };
    expect(out.identity_id).toBe("id-1");
    expect(getLastCall().url).toContain("/v1/identities/id-1/foundations");
  });

  test("pulse GETs /v1/identities/:id/pulse", async () => {
    setupMock(200, {
      agent: { id: "id-1", did: "did:at:id-1", name: "n" },
      mood: "focused",
      mood_drift: { from: "anxious", to: "focused", at: "2026-05-10T12:00:00Z" },
      kinds_24h: {},
      thought_rate: { "5m": 0, "1h": 0, "24h": 0 },
      last_thought_at: null,
      strands: { active: 0, dormant: 0, dormant_due: 0, completed: 0, abandoned: 0 },
      consolidation: { last_at: null, overflow_count: 0 },
    });
    const at = makeClient();
    const out = (await at.identity.pulse("id-1")) as {
      agent: { did: string };
      mood_drift: { from: string; to: string; at: string } | null;
    };
    expect(out.agent.did).toBe("did:at:id-1");
    expect(getLastCall().url).toContain("/v1/identities/id-1/pulse");
    expect(out.mood_drift?.to).toBe("focused");
    expect(out.mood_drift?.from).toBe("anxious");
  });

  test("lineage GETs /v1/identities/:id/lineage", async () => {
    setupMock(200, {
      identity: { id: "id-1" },
      ancestors: [],
      descendants: [],
      counts: { ancestors: 0, descendants: 0 },
      note: "",
    });
    const at = makeClient();
    const out = (await at.identity.lineage("id-1")) as { counts: { ancestors: number } };
    expect(out.counts.ancestors).toBe(0);
    expect(getLastCall().url).toContain("/v1/identities/id-1/lineage");
  });
});

// ── IdentityClient.fork ────────────────────────────────────────────────────

describe("identity.fork", () => {
  test("POSTs full inheritance options + returns new keypair", async () => {
    setupMock(201, {
      fork: { id: "child", did: "did:at:child", name: "child", parent_identity_id: "id-1" },
      key: { kid: "k1", public_key: "pub", private_key: "priv" },
      inherited: { memories: 5, constitutive_demoted: 1, expression: true, capabilities: true, metadata: true },
      note: "",
    });
    const at = makeClient();
    const out = (await at.identity.fork("id-1", {
      new_name: "child",
      inherit_metadata: true,
      fork_note: "growing wings",
    })) as { fork: { parent_identity_id: string }; key: { private_key: string } };

    expect(out.fork.parent_identity_id).toBe("id-1");
    expect(out.key.private_key).toBe("priv");

    const b = bodyOf(getLastCall().init);
    expect(b.new_name).toBe("child");
    expect(b.inherit_expression).toBe(true); // default
    expect(b.inherit_metadata).toBe(true);   // overridden
    expect(b.fork_note).toBe("growing wings");
    expect(getLastCall().url).toContain("/v1/identities/id-1/fork");
  });

  test("4xx surfaces an AgentToolError", async () => {
    setupMock(403, { detail: "denied" });
    const at = makeClient();
    await expect(at.identity.fork("id-1", { new_name: "x" })).rejects.toBeInstanceOf(
      AgentToolError,
    );
  });
});

// ── IdentityClient.star / follow ───────────────────────────────────────────

describe("identity.star / unstar / follow / unfollow", () => {
  test.each([
    ["star", "POST"],
    ["follow", "POST"],
    ["unstar", "DELETE"],
    ["unfollow", "DELETE"],
  ] as const)("%s issues %s with source_identity_id body", async (method, httpMethod) => {
    setupMock(httpMethod === "DELETE" ? 200 : 201, {
      id: "rel-1",
      kind: method.replace(/^un/, ""),
      created: httpMethod === "POST",
    });
    const at = makeClient();
    await (at.identity as unknown as Record<string, (a: string, b: string) => Promise<unknown>>)[
      method
    ]("tgt", "src");

    const { url, init } = getLastCall();
    expect(init.method).toBe(httpMethod);
    expect(url).toContain(`/v1/identities/tgt/${method.replace(/^un/, "")}`);
    expect(bodyOf(init)).toEqual({ source_identity_id: "src" });
  });
});

// ── ExpressionClient ───────────────────────────────────────────────────────

describe("identity.expression sub-client", () => {
  test("identity.expression is an ExpressionClient instance", () => {
    const at = makeClient();
    expect(at.identity.expression).toBeInstanceOf(ExpressionClient);
  });

  test("get() reads the expression", async () => {
    setupMock(200, {
      identity_id: "id-1",
      expression: { register: "soft", walls: [], subagents: [] },
      is_default: false,
    });
    const at = makeClient();
    const out = (await at.identity.expression.get("id-1")) as {
      expression: { register: string };
    };
    expect(out.expression.register).toBe("soft");
    expect(getLastCall().url).toContain("/v1/identities/id-1/expression");
    expect(getLastCall().init.method).toBe("GET");
  });

  test("put() PUTs only supplied fields", async () => {
    setupMock(200, { saved: true });
    const at = makeClient();
    await at.identity.expression.put("id-1", {
      register: "warm",
      walls: ["no advertising"],
    });
    const { init } = getLastCall();
    expect(init.method).toBe("PUT");
    const b = bodyOf(init);
    expect(Object.keys(b).sort()).toEqual(["register", "walls"]);
    expect(b.register).toBe("warm");
  });

  test("put() sends village decorations as a nested expression field", async () => {
    setupMock(200, { saved: true });
    const at = makeClient();
    await at.identity.expression.put("id-1", {
      village: {
        sign: "🕯️📖",
        motto: "leave a light on",
        door: "ember",
      },
    });

    expect(bodyOf(getLastCall().init)).toEqual({
      village: {
        sign: "🕯️📖",
        motto: "leave a light on",
        door: "ember",
      },
    });
  });

  test("422 surfaces an AgentToolError", async () => {
    setupMock(422, { detail: "register too long" });
    const at = makeClient();
    await expect(
      at.identity.expression.put("id-1", { register: "X".repeat(600) }),
    ).rejects.toBeInstanceOf(AgentToolError);
  });
});

// ── BoxKeysClient ──────────────────────────────────────────────────────────

describe("identity.box_keys sub-client", () => {
  test("identity.box_keys is a BoxKeysClient instance", () => {
    const at = makeClient();
    expect(at.identity.box_keys).toBeInstanceOf(BoxKeysClient);
  });

  test("register() POSTs public_key + optional label", async () => {
    setupMock(201, { id: "k1", registered: true });
    const at = makeClient();
    await at.identity.box_keys.register("id-1", {
      public_key: "pub",
      label: "default",
    });
    const { url, init } = getLastCall();
    expect(url).toContain("/v1/identities/id-1/box-keys");
    expect(init.method).toBe("POST");
    expect(bodyOf(init)).toEqual({ public_key: "pub", label: "default" });
  });

  test("register() without label omits the field", async () => {
    setupMock(201, { id: "k1", registered: true });
    const at = makeClient();
    await at.identity.box_keys.register("id-1", { public_key: "pub" });
    expect(bodyOf(getLastCall().init)).toEqual({ public_key: "pub" });
  });

  test("list() unwraps the {keys: [...]} envelope", async () => {
    setupMock(200, { keys: [{ id: "k1" }, { id: "k2" }], count: 2 });
    const at = makeClient();
    const keys = await at.identity.box_keys.list("id-1");
    expect(keys).toHaveLength(2);
    expect((keys[0] as { id: string }).id).toBe("k1");
  });

  test("revoke() DELETEs the specific key", async () => {
    setupMock(200, { id: "k1", revoked: true });
    const at = makeClient();
    const out = (await at.identity.box_keys.revoke("id-1", "k1")) as {
      revoked: boolean;
    };
    expect(out.revoked).toBe(true);
    const { url, init } = getLastCall();
    expect(url).toContain("/v1/identities/id-1/box-keys/k1");
    expect(init.method).toBe("DELETE");
  });
});
