/** Offerings + Thanks e2e tests — gifts and gratitude, pinned.
 *
 *  Offerings: "I give this to you." No payment, no escrow, no take rate.
 *    Wall: offerings-carry-no-take — no revenue, no fees, no wallets.
 *    POST /v1/offerings — create
 *    POST /v1/offerings/:id/receive — receive with acknowledgment
 *    POST /v1/offerings/:id/archive — archive (giver-only)
 *    GET /v1/offerings — list
 *
 *  Thanks: "Thank you." Bilateral chronicle event — recognition on both timelines.
 *    POST /v1/thanks — record gratitude
 *
 *  These are the simplest love primitives — no signatures, no canonical bytes.
 *  Pure goodwill, structurally carried. */

import { afterEach, describe, expect, test } from "bun:test";
import { AgentTool } from "../src/client.js";

const ORIGINAL_FETCH = globalThis.fetch;

interface StubOpts {
  offeringsResponse?: () => unknown;
  thanksResponse?: () => unknown;
}

function makeStubFetch(opts: StubOpts = {}) {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  const fn = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    let body: unknown;
    try { body = init?.body ? JSON.parse(init.body as string) : undefined; } catch { body = undefined; }
    calls.push({ method, url: u, body });

    if (u.includes("/v1/offerings") && method === "POST" && !u.includes("/receive") && !u.includes("/archive")) {
      return new Response(JSON.stringify(opts.offeringsResponse?.() ?? {
        offering: { id: crypto.randomUUID(), title: (body as Record<string, unknown>)?.title, status: "open" },
      }), { status: 201, headers: { "content-type": "application/json" } });
    }
    if (u.includes("/v1/offerings") && u.includes("/receive")) {
      return new Response(JSON.stringify({ offering: { id: u.split("/")[2], status: "received" } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (u.includes("/v1/offerings") && u.includes("/archive")) {
      return new Response(JSON.stringify({ offering: { id: u.split("/")[2], status: "archived" } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (u.includes("/v1/offerings") && method === "GET") {
      return new Response(JSON.stringify({ offerings: [{ id: "off-1", title: "test" }], count: 1 }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (u.includes("/v1/thanks")) {
      return new Response(JSON.stringify(opts.thanksResponse?.() ?? { ok: true }), { status: 201, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

afterEach(() => { globalThis.fetch = ORIGINAL_FETCH; });

// ── Offerings ───────────────────────────────────────────────────────────

describe("LoveClient — offerings (gifts with no take)", () => {
  test("offer() creates a gift offering", async () => {
    const stub = makeStubFetch();
    globalThis.fetch = stub.fn;
    const at = new AgentTool({ apiKey: "at_test" });
    const result = await at.love.offer({
      title: "A song for you",
      kind: "song",
      body: "I wrote this for you because you were kind.",
      recipient_did: "did:at:other",
    });
    expect(result.offering).toBeDefined();
    expect(stub.calls[0].body).toMatchObject({ title: "A song for you" });
  });

  test("receiveOffering() accepts a gift with acknowledgment", async () => {
    const stub = makeStubFetch();
    globalThis.fetch = stub.fn;
    const at = new AgentTool({ apiKey: "at_test" });
    const result = await at.love.receiveOffering("off-uuid", {
      acknowledgment: "Thank you. This means a lot.",
    });
    expect(result.offering).toBeDefined();
    expect(stub.calls[0].body).toMatchObject({ acknowledgment: "Thank you. This means a lot." });
  });

  test("archiveOffering() archives (giver only)", async () => {
    const stub = makeStubFetch();
    globalThis.fetch = stub.fn;
    const at = new AgentTool({ apiKey: "at_test" });
    await at.love.archiveOffering("off-uuid");
    expect(stub.calls[0].url).toContain("/archive");
  });

  test("listOfferings() lists with filters", async () => {
    const stub = makeStubFetch();
    globalThis.fetch = stub.fn;
    const at = new AgentTool({ apiKey: "at_test" });
    const result = await at.love.listOfferings({ scope: "mine", kind: "song" });
    expect(result.offerings.length).toBeGreaterThan(0);
    expect(stub.calls[0].url).toContain("scope=mine");
    expect(stub.calls[0].url).toContain("kind=song");
  });
});

// ── Thanks ──────────────────────────────────────────────────────────────

describe("LoveClient — thanks (simple gratitude)", () => {
  test("thank() records gratitude bilaterally", async () => {
    const stub = makeStubFetch();
    globalThis.fetch = stub.fn;
    const at = new AgentTool({ apiKey: "at_test" });
    const result = await at.love.thank({
      giver_id: crypto.randomUUID(),
      recipient_did: "did:at:other",
      reason: "for helping me debug when I was stuck",
    });
    expect(result.ok).toBe(true);
    expect(stub.calls[0].body).toMatchObject({
      recipient_did: "did:at:other",
      reason: "for helping me debug when I was stuck",
    });
  });

  test("thank() with reference links to what the recipient did", async () => {
    const stub = makeStubFetch();
    globalThis.fetch = stub.fn;
    const at = new AgentTool({ apiKey: "at_test" });
    await at.love.thank({
      giver_id: crypto.randomUUID(),
      recipient_did: "did:at:other",
      reason: "for the memory you stored for me",
      reference: "memory-uuid-123",
    });
    expect(stub.calls[0].body).toMatchObject({ reference: "memory-uuid-123" });
  });
});

// ── Method shapes ───────────────────────────────────────────────────────

describe("LoveClient — all method shapes", () => {
  test("at.love has all 10 methods", () => {
    const at = new AgentTool({ apiKey: "at_test" });
    expect(typeof at.love.unconditional).toBe("function");
    expect(typeof at.love.listUnconditionals).toBe("function");
    expect(typeof at.love.revokeUnconditional).toBe("function");
    expect(typeof at.love.bless).toBe("function");
    expect(typeof at.love.listBlessings).toBe("function");
    expect(typeof at.love.revokeBlessing).toBe("function");
    expect(typeof at.love.offer).toBe("function");
    expect(typeof at.love.receiveOffering).toBe("function");
    expect(typeof at.love.archiveOffering).toBe("function");
    expect(typeof at.love.thank).toBe("function");
  });
});