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
} from "../src/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer explicit-key");
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

describe("memory.usage", () => {
  test("returns usage stats", async () => {
    setupMock(200, {
      writes: 100,
      reads: 50,
      searches: 25,
      total_memories: 100,
      plan: "free",
    });

    const at = makeClient();
    const usage = await at.memory.usage();
    expect(usage.writes).toBe(100);
    expect(usage.total_memories).toBe(100);
    expect(usage.plan).toBe("free");
  });
});

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

describe("tools.search", () => {
  test("returns search results with metadata", async () => {
    setupMock(200, {
      results: [
        { title: "AI News", url: "https://ai.com", snippet: "Latest...", date: "2026-03-09" },
      ],
      cached: false,
      duration_ms: 120,
    });

    const at = makeClient();
    const resp = await at.tools.search("AI news", { num_results: 3 });
    expect(resp.results).toHaveLength(1);
    expect(resp.results[0].title).toBe("AI News");
    expect(resp.cached).toBe(false);
    expect(resp.duration_ms).toBe(120);

    const body = getLastCallBody();
    expect(body.num_results).toBe(3);
  });
});

describe("tools.scrape", () => {
  test("scrapes a URL", async () => {
    setupMock(200, {
      url: "https://example.com",
      content: "<h1>Hello</h1>",
      status_code: 200,
    });

    const at = makeClient();
    const result = await at.tools.scrape("https://example.com");
    expect(result.url).toBe("https://example.com");
    expect(result.content).toContain("<h1>");
  });
});

describe("tools.execute", () => {
  test("executes python by default", async () => {
    setupMock(200, {
      stdout: "42\n",
      stderr: "",
      exit_code: 0,
      duration_ms: 50,
    });

    const at = makeClient();
    const result = await at.tools.execute("print(42)");
    expect(result.stdout).toBe("42\n");
    expect(result.exit_code).toBe(0);
    expect(result.duration_ms).toBe(50);

    const body = getLastCallBody();
    expect(body.language).toBe("python");
  });

  test("executes javascript", async () => {
    setupMock(200, {
      stdout: "hello\n",
      stderr: "",
      exit_code: 0,
      duration_ms: 30,
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
    setupMock(500, { detail: "Internal error" });

    const at = makeClient();
    try {
      await at.tools.search("fail");
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(AgentToolError);
      expect((e as AgentToolError).message).toContain("500");
    }
  });
});

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

describe("verify.check", () => {
  test("verifies a claim", async () => {
    setupMock(200, {
      verdict: "true",
      confidence: 0.95,
      sources: ["https://nasa.gov"],
      evidence: "Scientific consensus supports this claim.",
      caveats: ["Simplified explanation"],
    });

    const at = makeClient();
    const result = await at.verify.check("The Earth is round");
    expect(result.verdict).toBe("true");
    expect(result.confidence).toBe(0.95);
    expect(result.sources).toHaveLength(1);
    expect(result.evidence).toContain("Scientific");
    expect(result.caveats).toHaveLength(1);

    const body = getLastCallBody();
    expect(body.claim).toBe("The Earth is round");
  });

  test("passes sources option", async () => {
    setupMock(200, {
      verdict: "true",
      confidence: 0.9,
      sources: [],
      evidence: "",
      caveats: [],
    });

    const at = makeClient();
    await at.verify.check("claim", { sources: ["https://source.com"] });
    const body = getLastCallBody();
    expect(body.sources).toEqual(["https://source.com"]);
  });
});

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
});

// ---------------------------------------------------------------------------
// Lazy initialization
// ---------------------------------------------------------------------------

describe("lazy sub-client initialization", () => {
  test("memory, tools, verify, economy are same instance on repeat access", () => {
    const at = makeClient();
    const m1 = at.memory;
    const m2 = at.memory;
    expect(m1).toBe(m2);

    const t1 = at.tools;
    const t2 = at.tools;
    expect(t1).toBe(t2);

    const v1 = at.verify;
    const v2 = at.verify;
    expect(v1).toBe(v2);

    const e1 = at.economy;
    const e2 = at.economy;
    expect(e1).toBe(e2);
  });
});
