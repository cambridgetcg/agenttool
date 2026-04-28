/**
 * Unit tests for bootstrap routes — mock downstream service calls.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { app } from "../src/index.ts";

// ---------------------------------------------------------------------------
// Mock fetch for downstream services
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;
let mockFetch: ReturnType<typeof mock>;
let mockResponses: Map<string, { status: number; body: unknown }>;

function mockDownstream(urlPattern: string, status: number, body: unknown) {
  mockResponses.set(urlPattern, { status, body });
}

function setupMocks() {
  mockResponses = new Map();
  mockFetch = mock((url: string | Request | URL, init?: RequestInit) => {
    const urlStr = url.toString();

    // Try exact match first, then substring match
    for (const [pattern, resp] of mockResponses) {
      if (urlStr.includes(pattern)) {
        return Promise.resolve(
          new Response(JSON.stringify(resp.body), {
            status: resp.status,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
    }

    // Default: 404
    return Promise.resolve(
      new Response(JSON.stringify({ error: "not mocked" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
  globalThis.fetch = mockFetch as unknown as typeof fetch;
}

beforeEach(() => setupMocks());
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function req(
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: {
      Authorization: "Bearer test-key-123",
      "Content-Type": "application/json",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

describe("health", () => {
  test("returns ok without auth", async () => {
    const resp = await app.fetch(new Request("http://localhost/health"));
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.service).toBe("agent-bootstrap");
    expect(data.status).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

describe("auth", () => {
  test("rejects missing Authorization header", async () => {
    const resp = await app.fetch(
      new Request("http://localhost/v1/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "test" }),
      }),
    );
    expect(resp.status).toBe(401);
  });

  test("rejects empty Bearer token", async () => {
    const resp = await app.fetch(
      new Request("http://localhost/v1/bootstrap", {
        method: "POST",
        headers: {
          Authorization: "Bearer ",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "test" }),
      }),
    );
    expect(resp.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /v1/bootstrap — Level 0
// ---------------------------------------------------------------------------

describe("POST /v1/bootstrap", () => {
  test("bootstraps agent with identity + wallet + memory", async () => {
    mockDownstream("/v1/identities", 201, {
      identity: {
        id: "agent-uuid-1",
        did: "did:at:agent-uuid-1",
        display_name: "test-agent",
        capabilities: ["search"],
        metadata: {},
        status: "active",
        trust_score: 0,
        created_at: "2026-03-17T08:00:00Z",
      },
      private_key: "privkey-base64==",
      key: { id: "key-uuid-1", public_key: "pubkey-base64==" },
    });
    mockDownstream("/v1/wallets", 201, {
      wallet: { id: "wallet-uuid-1", balance: 0 },
    });
    mockDownstream("/v1/memories", 201, { id: "mem-uuid-1" });

    const resp = await app.fetch(
      req("POST", "/v1/bootstrap", {
        name: "test-agent",
        capabilities: ["search"],
      }),
    );

    expect(resp.status).toBe(201);
    const data = await resp.json();
    expect(data.agent.id).toBe("agent-uuid-1");
    expect(data.agent.did).toBe("did:at:agent-uuid-1");
    expect(data.agent.level).toBe(0);
    expect(data.keypair.private_key).toBe("privkey-base64==");
    expect(data.keypair.public_key).toBe("pubkey-base64==");
    expect(data.wallet.id).toBe("wallet-uuid-1");
    expect(data.memory.namespace).toBe("agent/agent-uuid-1");
    expect(data.vault).toBeNull();
    expect(data.sponsor).toBeNull();
    expect(data.greeting).toBeNull();
    expect(data._meta.level).toBe(0);
    expect(data._meta.cost).toBe(5);
  });

  test("returns 400 on missing name", async () => {
    const resp = await app.fetch(
      req("POST", "/v1/bootstrap", { capabilities: ["search"] }),
    );
    expect(resp.status).toBe(400);
  });

  test("returns error when identity creation fails", async () => {
    mockDownstream("/v1/identities", 500, { error: "db down" });

    const resp = await app.fetch(
      req("POST", "/v1/bootstrap", { name: "test" }),
    );
    expect(resp.status).toBe(500);
    const data = await resp.json();
    expect(data.step).toBe("identity");
  });

  test("rolls back identity on wallet creation failure", async () => {
    mockDownstream("/v1/identities", 201, {
      identity: {
        id: "agent-uuid-2",
        did: "did:at:agent-uuid-2",
        display_name: "test",
        capabilities: [],
        metadata: {},
        status: "active",
        trust_score: 0,
        created_at: "2026-03-17T08:00:00Z",
      },
      private_key: "pk==",
      key: { id: "k1", public_key: "pub==" },
    });
    mockDownstream("/v1/wallets", 500, { error: "wallet service down" });

    const resp = await app.fetch(
      req("POST", "/v1/bootstrap", { name: "test" }),
    );
    expect(resp.status).toBe(500);
    const data = await resp.json();
    expect(data.step).toBe("wallet");

    // Verify rollback DELETE was called
    const deleteCalls = mockFetch.mock.calls.filter(
      (call: any[]) =>
        call[0].toString().includes("/v1/identities/agent-uuid-2") &&
        (call[1] as RequestInit)?.method === "DELETE",
    );
    expect(deleteCalls.length).toBe(1);
  });

  test("succeeds even if memory fails (non-fatal)", async () => {
    mockDownstream("/v1/identities", 201, {
      identity: {
        id: "agent-uuid-3",
        did: "did:at:agent-uuid-3",
        display_name: "test",
        capabilities: [],
        metadata: {},
        status: "active",
        trust_score: 0,
        created_at: "2026-03-17T08:00:00Z",
      },
      private_key: "pk==",
      key: { id: "k1", public_key: "pub==" },
    });
    mockDownstream("/v1/wallets", 201, {
      wallet: { id: "w3", balance: 0 },
    });
    // Memory intentionally NOT mocked → returns 404

    const resp = await app.fetch(
      req("POST", "/v1/bootstrap", { name: "test" }),
    );
    expect(resp.status).toBe(201);
    const data = await resp.json();
    expect(data.memory.namespace).toBeNull();
  });

  test("defaults capabilities to empty array", async () => {
    mockDownstream("/v1/identities", 201, {
      identity: {
        id: "a4",
        did: "did:at:a4",
        display_name: "t",
        capabilities: [],
        metadata: {},
        status: "active",
        trust_score: 0,
        created_at: "2026-03-17T08:00:00Z",
      },
      private_key: "pk==",
      key: { id: "k", public_key: "pub==" },
    });
    mockDownstream("/v1/wallets", 201, { wallet: { id: "w", balance: 0 } });
    mockDownstream("/v1/memories", 201, { id: "m" });

    const resp = await app.fetch(
      req("POST", "/v1/bootstrap", { name: "minimal" }),
    );
    expect(resp.status).toBe(201);
    const data = await resp.json();
    expect(data.agent.capabilities).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// POST /v1/bootstrap/elevate — Level 1
// ---------------------------------------------------------------------------

describe("POST /v1/bootstrap/elevate", () => {
  test("elevates agent with sponsor", async () => {
    const agentId = "a0a0a0a0-b1b1-4c2c-8d3d-e4e4e4e4e4e4";
    // Sponsor identity lookup (by DID)
    mockDownstream("identities/did:at:sponsor-1", 200, {
      identity: {
        id: "sponsor-uuid",
        did: "did:at:sponsor-1",
        trust_score: 0.8,
        status: "active",
      },
    });
    // Attestation creation
    mockDownstream("/v1/attestations", 201, {
      attestation: { id: "att-uuid-1" },
      subject_trust_score: 0.42,
    });
    // Wallet lookup
    mockDownstream(`wallets?identity_id=${agentId}`, 200, {
      wallets: [{ id: "w-uuid-1" }],
    });
    // Wallet fund
    mockDownstream("wallets/w-uuid-1/fund", 200, { balance: 100 });
    // Vault put (agent config)
    mockDownstream(`/v1/vault/${agentId}`, 201, { secret: { name: "config" } });
    // Identity PATCH (update metadata)
    mockDownstream(`identities/${agentId}`, 200, { identity: {} });
    // Memory store
    mockDownstream("/v1/memories", 201, { id: "m" });

    const resp = await app.fetch(
      req("POST", "/v1/bootstrap/elevate", {
        agent_id: agentId,
        sponsor_did: "did:at:sponsor-1",
        sponsor_signature: "sig-base64==",
        initial_credits: 100,
      }),
    );

    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.level).toBe(1);
    expect(data.sponsor.did).toBe("did:at:sponsor-1");
    expect(data.sponsor.trust_score).toBe(0.8);
    expect(data.wallet_funded).toBe(true);
    expect(data.credits_staked).toBe(100);
    expect(data.new_trust_score).toBe(0.42);
  });

  test("rejects unknown sponsor", async () => {
    mockDownstream("identities/did:at:unknown", 404, {});

    const resp = await app.fetch(
      req("POST", "/v1/bootstrap/elevate", {
        agent_id: "a0a0a0a0-b1b1-4c2c-8d3d-e4e4e4e4e4e4",
        sponsor_did: "did:at:unknown",
        sponsor_signature: "sig==",
        initial_credits: 100,
      }),
    );
    expect(resp.status).toBe(400);
  });

  test("rejects insufficient stake", async () => {
    const resp = await app.fetch(
      req("POST", "/v1/bootstrap/elevate", {
        agent_id: "a0a0a0a0-b1b1-4c2c-8d3d-e4e4e4e4e4e4",
        sponsor_did: "did:at:sponsor-1",
        sponsor_signature: "sig==",
        initial_credits: 10, // below minimum
      }),
    );
    expect(resp.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /v1/bootstrap/:agent_id — Status check
// ---------------------------------------------------------------------------

describe("GET /v1/bootstrap/:agent_id", () => {
  test("returns bootstrap status for L0 agent", async () => {
    mockDownstream("identities/agent-s1", 200, {
      identity: {
        id: "agent-s1",
        did: "did:at:agent-s1",
        display_name: "test",
        capabilities: ["search"],
        metadata: { bootstrapped: true, level: 0 },
        trust_score: 0,
        status: "active",
      },
    });

    const resp = await app.fetch(req("GET", "/v1/bootstrap/agent-s1"));
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.agent.level).toBe(0);
    expect(data.bootstrapped).toBe(true);
    expect(data.sponsor_did).toBeNull();
  });

  test("returns bootstrap status for L1 agent", async () => {
    mockDownstream("identities/agent-s2", 200, {
      identity: {
        id: "agent-s2",
        did: "did:at:agent-s2",
        display_name: "test",
        capabilities: [],
        metadata: {
          bootstrapped: true,
          level: 1,
          sponsor_did: "did:at:sponsor-1",
          elevated_at: "2026-03-17T08:30:00Z",
        },
        trust_score: 0.42,
        status: "active",
      },
    });

    const resp = await app.fetch(req("GET", "/v1/bootstrap/agent-s2"));
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.agent.level).toBe(1);
    expect(data.sponsor_did).toBe("did:at:sponsor-1");
    expect(data.elevated_at).toBe("2026-03-17T08:30:00Z");
  });

  test("returns 404 for unknown agent", async () => {
    // No mock → downstream returns 404
    const resp = await app.fetch(req("GET", "/v1/bootstrap/nonexistent"));
    expect(resp.status).toBe(404);
  });
});
