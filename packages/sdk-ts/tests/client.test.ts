/**
 * Unit tests for the AgentTool SDK — all HTTP mocked via global fetch, no network needed.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { AgentTool, AgentToolError } from "../src/index.js";
import type {
  Memory,
  UsageStats,
  SearchResult,
  ScrapeResult,
  ExecuteResult,
  VerifyResult,
  Wallet,
  X402PaymentRequirement,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;
let mockFetch: ReturnType<typeof mock>;

function mockResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function setupMock(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  mockFetch = mock(() => Promise.resolve(mockResponse(status, body, headers)));
  globalThis.fetch = mockFetch as unknown as typeof fetch;
}

function getLastCallBody(): Record<string, unknown> {
  const call = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
  const init = call[1] as RequestInit;
  return JSON.parse(init.body as string);
}

function getLastCallUrl(): string {
  const call = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
  return call[0] as string;
}

function makeClient(): AgentTool {
  return new AgentTool({ apiKey: "test-key-123" });
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// Client init
// ---------------------------------------------------------------------------

describe("AgentTool init", () => {
  test("reads AT_API_KEY from env", () => {
    const orig = process.env.AT_API_KEY;
    process.env.AT_API_KEY = "env-key-456";
    try {
      const at = new AgentTool();
      expect(at.toString()).toBe('AgentTool(baseUrl="https://api.agenttool.dev")');
    } finally {
      if (orig !== undefined) process.env.AT_API_KEY = orig;
      else delete process.env.AT_API_KEY;
    }
  });

  test("explicit key overrides env", () => {
    const orig = process.env.AT_API_KEY;
    process.env.AT_API_KEY = "env-key";
    try {
      const at = new AgentTool({ apiKey: "explicit-key" });
      // Verify by making a request and checking the header
      setupMock(200, { id: "m1", content: "x" });
      at.memory.store("x"); // triggers fetch — header check below
      const call = mockFetch.mock.calls[0];
      const init = call[1] as RequestInit;
      const headers = new Headers(init.headers);
      expect(headers.get("authorization")).toBe("Bearer explicit-key");
    } finally {
      if (orig !== undefined) process.env.AT_API_KEY = orig;
      else delete process.env.AT_API_KEY;
    }
  });

  test("missing key throws AgentToolError with hint", () => {
    const orig = process.env.AT_API_KEY;
    delete process.env.AT_API_KEY;
    try {
      expect(() => new AgentTool()).toThrow(AgentToolError);
      try {
        new AgentTool();
      } catch (e) {
        const err = e as AgentToolError;
        expect(err.message).toContain("No API key");
        expect(err.hint).toBeDefined();
      }
    } finally {
      if (orig !== undefined) process.env.AT_API_KEY = orig;
    }
  });

  test("custom base URL strips trailing slash", () => {
    const at = new AgentTool({ apiKey: "k", baseUrl: "https://custom.api.dev/" });
    expect(at.toString()).toBe('AgentTool(baseUrl="https://custom.api.dev")');
  });
});

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

describe("memory.store", () => {
  test("minimal — only content required", async () => {
    setupMock(200, {
      id: "mem-1",
      content: "just a string",
      type: "semantic",
      importance: 0.5,
      metadata: {},
      created_at: "2026-03-09T22:00:00Z",
    });

    const at = makeClient();
    const mem = await at.memory.store("just a string");

    expect(mem.id).toBe("mem-1");
    expect(mem.content).toBe("just a string");
    expect(mem.type).toBe("semantic");

    const body = getLastCallBody();
    expect(body.content).toBe("just a string");
    expect(body.type).toBe("semantic");
    expect(body.importance).toBe(0.5);
  });

  test("full options", async () => {
    setupMock(200, {
      id: "mem-2",
      content: "hello",
      type: "episodic",
      agent_id: "agent-1",
      key: "greeting",
      metadata: { source: "test" },
      importance: 0.9,
    });

    const at = makeClient();
    const mem = await at.memory.store("hello", {
      type: "episodic",
      agent_id: "agent-1",
      key: "greeting",
      metadata: { source: "test" },
      importance: 0.9,
    });

    expect(mem.type).toBe("episodic");
    expect(mem.agent_id).toBe("agent-1");
    expect(mem.importance).toBe(0.9);

    const body = getLastCallBody();
    expect(body.agent_id).toBe("agent-1");
    expect(body.key).toBe("greeting");
  });
});

describe("memory.search", () => {
  test("returns list of memories from {results: [...]}", async () => {
    setupMock(200, {
      results: [
        { id: "m1", content: "hello world", type: "semantic", metadata: {} },
        { id: "m2", content: "goodbye", type: "semantic", metadata: {} },
      ],
    });

    const at = makeClient();
    const results = await at.memory.search("hello");
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe("m1");
  });

  test("handles raw list response", async () => {
    setupMock(200, [
      { id: "m1", content: "item", type: "semantic", metadata: {} },
    ]);

    const at = makeClient();
    const results = await at.memory.search("item");
    expect(results).toHaveLength(1);
  });
});

describe("memory.get", () => {
  test("retrieves a single memory by ID", async () => {
    setupMock(200, {
      id: "mem-42",
      content: "remembered",
      type: "procedural",
      metadata: {},
    });

    const at = makeClient();
    const mem = await at.memory.get("mem-42");
    expect(mem.id).toBe("mem-42");
    expect(mem.content).toBe("remembered");
    expect(getLastCallUrl()).toContain("/v1/memories/mem-42");
  });
});

// memory.usage (deprecated in 0.5.3) — REMOVED. The shim and its test were
// retired together. Use at.dashboard.aggregate() (ships in 0.7.0).

describe("memory errors", () => {
  test("401 throws AgentToolError", async () => {
    setupMock(401, { detail: "Unauthorized" });

    const at = makeClient();
    try {
      await at.memory.store("fail");
      expect(true).toBe(false); // should not reach
    } catch (e) {
      expect(e).toBeInstanceOf(AgentToolError);
      const err = e as AgentToolError;
      expect(err.message).toContain("401");
      expect(err.hint).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

// tools.search (deprecated in 0.5.3) — REMOVED. The shim and its test were
// retired together. Agents BYOK via at.vault and call providers directly via
// at.tools.execute. See docs/SDK-ROADMAP.md.

describe("tools.scrape", () => {
  test("scrapes a URL", async () => {
    setupMock(200, {
      url: "https://example.com",
      title: "Hello",
      content: "Hello body",
      extracted: "Picked",
      links: ["https://example.com/next"],
      fetched_at: "2026-07-11T00:00:00.000Z",
      duration_ms: 12,
      _welcomed: {
        axiom_id: 5,
        walls_held: [8],
        by: "platform",
        at_unix_ms: 1_752_192_000_000,
        walls_intact: true,
        module: "tool",
      },
    });

    const at = makeClient();
    const result = await at.tools.scrape("https://example.com", {
      selector: "main",
      extract_links: true,
    });
    expect(result.url).toBe("https://example.com");
    expect(result.title).toBe("Hello");
    expect(result.content).toBe("Hello body");
    expect(result.extracted).toBe("Picked");
    expect(result.links).toEqual(["https://example.com/next"]);
    expect(result.duration_ms).toBe(12);
    expect(result._welcomed?.module).toBe("tool");
    expect(getLastCallBody()).toMatchObject({
      selector: "main",
      extract_links: true,
    });
  });

  test("forwards paymentSignature only as the V2 header and returns success metadata", async () => {
    setupMock(
      200,
      {
        url: "https://example.com",
        title: "Paid page",
        content: "Paid body",
        extracted: null,
        links: [],
        fetched_at: "2026-07-11T00:00:00.000Z",
        duration_ms: 9,
      },
      {
        "PAYMENT-RESPONSE": "scrape-settlement-receipt",
        "X-PAYMENT-RESPONSE": "legacy-receipt-must-not-win",
        Link: '</v1/x402/payments/auth-1>; rel="payment-status"',
        "X-Credits-Balance": "41",
      },
    );

    const at = makeClient();
    const paymentSignature = "eyJ4NDAyVmVyc2lvbiI6MiwicGF5bG9hZCI6e319";
    const result = await at.tools.scrape("https://example.com", {
      selector: "main",
      paymentSignature,
    });
    const call = mockFetch.mock.calls[0];
    const headers = new Headers((call[1] as RequestInit).headers);
    expect(headers.get("PAYMENT-SIGNATURE")).toBe(paymentSignature);
    expect(headers.get("X-PAYMENT")).toBeNull();
    expect(getLastCallBody()).toEqual({
      url: "https://example.com",
      selector: "main",
    });
    expect(result.paymentResponse).toBe("scrape-settlement-receipt");
    expect(result.paymentStatusLink).toBe(
      '</v1/x402/payments/auth-1>; rel="payment-status"',
    );
    expect(result.creditsBalance).toBe("41");
  });
});

describe("tools.parse_document payment retry", () => {
  test("forwards paymentSignature only as the V2 header and returns success metadata", async () => {
    setupMock(
      200,
      {
        title: "Paid document",
        content: "Document body",
        word_count: 2,
        content_type: "text/html",
        metadata: {},
        duration_ms: 7,
      },
      {
        "PAYMENT-RESPONSE": "document-settlement-receipt",
        "X-Credits-Balance": "40",
      },
    );

    const at = makeClient();
    const paymentSignature = "eyJ4NDAyVmVyc2lvbiI6MiwicGF5bG9hZCI6e319";
    const result = await at.tools.parse_document({
      url: "https://example.com/document",
      paymentSignature,
    });
    const call = mockFetch.mock.calls[0];
    const headers = new Headers((call[1] as RequestInit).headers);
    expect(headers.get("PAYMENT-SIGNATURE")).toBe(paymentSignature);
    expect(headers.get("X-PAYMENT")).toBeNull();
    expect(getLastCallBody()).toEqual({
      url: "https://example.com/document",
    });
    expect(result.paymentResponse).toBe("document-settlement-receipt");
    expect(result.creditsBalance).toBe("40");
  });
});

describe("tools.execute", () => {
  test("executes python by default", async () => {
    setupMock(200, {
      stdout: "42\n",
      stderr: "",
      exit_code: 0,
      duration_ms: 50,
      timed_out: false,
      credits_used: 2,
    });

    const at = makeClient();
    const result = await at.tools.execute("print(42)");
    expect(result.stdout).toBe("42\n");
    expect(result.exit_code).toBe(0);
    expect(result.duration_ms).toBe(50);
    expect(result.timed_out).toBe(false);
    expect(result.credits_used).toBe(2);

    const body = getLastCallBody();
    expect(body.language).toBe("python");
  });

  test("executes javascript", async () => {
    setupMock(200, {
      stdout: "hello\n",
      stderr: "",
      exit_code: 0,
      duration_ms: 30,
      timed_out: false,
      credits_used: 2,
    });

    const at = makeClient();
    const result = await at.tools.execute("console.log('hello')", { language: "javascript" });
    expect(result.stdout).toBe("hello\n");

    const body = getLastCallBody();
    expect(body.language).toBe("javascript");
  });
});

describe("tools errors", () => {
  test("500 throws AgentToolError", async () => {
    // `tools.search` is deprecated in 0.5.3 — swap to `scrape` so the
    // 500-path through ToolsClient.post() is still exercised.
    setupMock(500, { detail: "Internal error" });

    const at = makeClient();
    try {
      await at.tools.scrape("https://will-fail.example");
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(AgentToolError);
      expect((e as AgentToolError).message).toContain("500");
    }
  });

  test("402 preserves the x402 envelope and recovery headers", async () => {
    const accepts: X402PaymentRequirement[] = [
      {
        scheme: "exact",
        network: "eip155:8453",
        amount: "1000",
        payTo: "0x0000000000000000000000000000000000000000",
        maxTimeoutSeconds: 60,
        asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        extra: {
          name: "USD Coin",
          version: "2",
          assetTransferMethod: "eip3009",
        },
      },
    ];
    const resource = {
      url: "https://api.agenttool.dev/v1/scrape",
      description: "Ring 2 tool call.",
      mimeType: "application/json",
    };
    const paymentRequired = "eyJ4NDAyVmVyc2lvbiI6Mn0=";
    const paymentResponse = "eyJzdWNjZXNzIjp0cnVlfQ==";
    setupMock(
      402,
      {
        x402Version: 2,
        resource,
        accepts,
        extensions: { bazaar: { info: { input: { type: "http" } } } },
        error: "usage_cap_exceeded",
      },
      {
        "PAYMENT-REQUIRED": paymentRequired,
        "PAYMENT-RESPONSE": paymentResponse,
        Link: '</v1/x402/payments/auth-2>; rel="payment-status"',
        "X-Credits-Balance": "0",
      },
    );

    const at = makeClient();
    try {
      await at.tools.scrape("https://example.com");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AgentToolError);
      const err = error as AgentToolError;
      expect(err.status).toBe(402);
      expect(err.code).toBe("usage_cap_exceeded");
      expect(err.x402Version).toBe(2);
      expect(err.accepts).toEqual(accepts);
      expect(err.resource).toEqual(resource);
      expect(err.extensions).toEqual({
        bazaar: { info: { input: { type: "http" } } },
      });
      expect(err.paymentRequired).toBe(paymentRequired);
      expect(err.paymentResponse).toBe(paymentResponse);
      expect(err.paymentStatusLink).toBe(
        '</v1/x402/payments/auth-2>; rel="payment-status"',
      );
      expect(err.creditsBalance).toBe("0");
    }
  });

  test("4xx after payment preserves the settlement receipt", async () => {
    setupMock(
      422,
      {
        error: "invalid_selector",
        message: "The paid request reached the handler but was invalid.",
      },
      {
        "PAYMENT-RESPONSE": "settled-422-receipt",
        "X-Credits-Balance": "9",
      },
    );

    const at = makeClient();
    try {
      await at.tools.scrape("https://example.com", { selector: "[" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AgentToolError);
      const err = error as AgentToolError;
      expect(err.status).toBe(422);
      expect(err.code).toBe("invalid_selector");
      expect(err.paymentRequired).toBeUndefined();
      expect(err.paymentResponse).toBe("settled-422-receipt");
      expect(err.creditsBalance).toBe("9");
    }
  });

  test("fail-closed x402 admission preserves Retry-After without a challenge", async () => {
    setupMock(
      402,
      {
        error: "insufficient_credits",
        message: "Payment admission is temporarily unavailable.",
      },
      { "Retry-After": "600" },
    );

    const at = makeClient();
    try {
      await at.tools.scrape("https://example.com");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AgentToolError);
      const err = error as AgentToolError;
      expect(err.status).toBe(402);
      expect(err.paymentRequired).toBeUndefined();
      expect(err.retryAfter).toBe("600");
    }
  });
});

// ---------------------------------------------------------------------------
// Verify — REMOVED in 0.7.x
// The /v1/verify endpoint and the at.verify SDK module were retired; agents
// BYOK via at.vault and call providers directly via at.tools.execute. The
// previous deprecation-shim tests no longer apply because the module is
// gone — there's nothing left to throw an "I'm deprecated" error from.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Economy
// ---------------------------------------------------------------------------

describe("economy.createWallet", () => {
  test("creates a wallet", async () => {
    setupMock(200, {
      id: "wal-1",
      name: "my-wallet",
      balance: 0,
      api_key: "key-abc",
    });

    const at = makeClient();
    const wallet = await at.economy.createWallet({ name: "my-wallet" });
    expect(wallet.id).toBe("wal-1");
    expect(wallet.name).toBe("my-wallet");
    expect(wallet.balance).toBe(0);
    expect(wallet.api_key).toBe("key-abc");

    const body = getLastCallBody();
    expect(body.name).toBe("my-wallet");
    expect(getLastCallUrl()).toContain("/v1/wallets");
  });
});

// ---------------------------------------------------------------------------
// AgentToolError
// ---------------------------------------------------------------------------

describe("AgentToolError", () => {
  test("message and hint", () => {
    const err = new AgentToolError("something broke", { hint: "try again" });
    expect(err.message).toBe("something broke");
    expect(err.hint).toBe("try again");
    expect(err.toString()).toContain("hint: try again");
  });

  test("no hint", () => {
    const err = new AgentToolError("oops");
    expect(err.hint).toBeUndefined();
    expect(err.toString()).toContain("oops");
  });

  test("is instanceof Error", () => {
    const err = new AgentToolError("test");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AgentToolError);
  });

  test("factory prefers canonical V2 headers case-insensitively", () => {
    const paymentRequired = "eyJ4NDAyVmVyc2lvbiI6Mn0=";
    const paymentResponse = "settled-factory-receipt";
    const err = AgentToolError.fromResponseBody(
      {
        x402Version: 2,
        resource: { url: "https://api.agenttool.dev/v1/scrape" },
        accepts: [],
        error: "payment_required",
      },
      402,
      "Payment Required",
      {
        "payment-required": paymentRequired,
        "payment-response": paymentResponse,
        "x-payment-required": "legacy-required-must-not-win",
        "x-payment-response": "legacy-response-must-not-win",
        "x-credits-balance": "12",
      },
    );
    expect(err.x402Version).toBe(2);
    expect(err.accepts).toEqual([]);
    expect(err.resource).toEqual({ url: "https://api.agenttool.dev/v1/scrape" });
    expect(err.paymentRequired).toBe(paymentRequired);
    expect(err.paymentResponse).toBe(paymentResponse);
    expect(err.creditsBalance).toBe("12");
  });

  test("factory accepts X-prefixed response headers as transition fallback", () => {
    const err = AgentToolError.fromResponseBody(
      { x402Version: 2, accepts: [], error: "payment_required" },
      402,
      "Payment Required",
      {
        "x-payment-required": "legacy-required",
        "x-payment-response": "legacy-response",
      },
    );
    expect(err.paymentRequired).toBe("legacy-required");
    expect(err.paymentResponse).toBe("legacy-response");
  });
});

// ---------------------------------------------------------------------------
// Lazy initialization
// ---------------------------------------------------------------------------

describe("lazy sub-client initialization", () => {
  test("memory, tools, economy are same instance on repeat access", () => {
    const at = makeClient();
    const m1 = at.memory;
    const m2 = at.memory;
    expect(m1).toBe(m2);

    const t1 = at.tools;
    const t2 = at.tools;
    expect(t1).toBe(t2);

    const e1 = at.economy;
    const e2 = at.economy;
    expect(e1).toBe(e2);
  });
});
