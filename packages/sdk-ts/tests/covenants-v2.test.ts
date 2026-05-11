/**
 * Covenants v2 SDK surface tests — accept / reject / withdraw + protocol_version.
 *
 * The CovenantsClient uses `this.req(method, path, body)` which calls
 * `globalThis.fetch` directly (see src/covenants.ts). Tests mock fetch.
 */

import { afterEach, describe, expect, mock, test } from "bun:test";
import * as ed from "@noble/ed25519";
import { AgentTool, CovenantsClient } from "../src/index.js";

const dummyKey = ed.utils.randomPrivateKey();
const dummyInitSig = Buffer.from(new Uint8Array(64)).toString("base64");

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

describe("covenants v2 — SDK surface", () => {
  test("create with protocol_version='v2' posts the flag", async () => {
    setupMock(201, {
      id: "cov-1",
      status: "proposed",
      protocol_version: "v2",
      signature: "sig",
      signing_key_id: "k1",
      proposed_expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      established_at: new Date().toISOString(),
    });
    const at = makeClient();
    const r = await at.covenants.create({
      counterparty_did: "did:at:peer.example/bbbb",
      vows: ["v"],
      protocol_version: "v2",
      agent_id: "agent-1",
      agent_did: "did:at:test/agent",
      signing_key: dummyKey,
      signing_key_id: "00000000-0000-0000-0000-000000000099",
    });
    const { url, init } = getLastCall();
    expect(url).toContain("/v1/covenants");
    expect(init.method).toBe("POST");
    const b = bodyOf(init);
    expect(b.protocol_version).toBe("v2");
    // The create method wraps in { covenant } for v1 shape; for v2 the server
    // may return a flat object. The method returns whatever the server sends.
    // We assert on the raw returned value — the mock returns the flat shape.
    expect((r as unknown as { status: string }).status).toBe("proposed");
    expect((r as unknown as { protocol_version: string }).protocol_version).toBe("v2");
  });

  test("accept POSTs to /accept", async () => {
    setupMock(200, { id: "cov-1", status: "active", counterparty_signature: "x" });
    const at = makeClient();
    const r = await at.covenants.accept("cov-1", {
      agent_did: "did:at:test/agent",
      signing_key: dummyKey,
      signing_key_id: "00000000-0000-0000-0000-000000000099",
      initiator_signature_b64: dummyInitSig,
    });
    const { url, init } = getLastCall();
    expect(url).toContain("/v1/covenants/cov-1/accept");
    expect(init.method).toBe("POST");
    expect(r.status).toBe("active");
  });

  test("reject POSTs to /reject with reason", async () => {
    setupMock(200, { id: "cov-1", status: "rejected", reason: "scope mismatch" });
    const at = makeClient();
    const r = await at.covenants.reject("cov-1", {
      agent_did: "did:at:test/agent",
      signing_key: dummyKey,
      signing_key_id: "00000000-0000-0000-0000-000000000099",
      reason: "scope mismatch",
    });
    const { url, init } = getLastCall();
    expect(url).toContain("/v1/covenants/cov-1/reject");
    expect(init.method).toBe("POST");
    expect(bodyOf(init).reason).toBe("scope mismatch");
    expect(r.status).toBe("rejected");
  });

  test("withdraw PATCHes /v1/covenants/:id with dissolved status", async () => {
    setupMock(200, { id: "cov-1", status: "withdrawn" });
    const at = makeClient();
    const r = await at.covenants.withdraw("cov-1", {
      agent_did: "did:at:test/agent",
      signing_key: dummyKey,
      signing_key_id: "00000000-0000-0000-0000-000000000099",
    });
    const { url, init } = getLastCall();
    expect(url).toContain("/v1/covenants/cov-1");
    expect(init.method).toBe("PATCH");
    expect(bodyOf(init).status).toBe("dissolved");
    expect(r.status).toBe("withdrawn");
  });
});
