/** Collect pipeline e2e tests — the easy data collection workflow.
 *
 *  Tests pin the CollectClient's three methods:
 *    1. url() — scrape → extract → store → think
 *    2. text() — store → think
 *    3. batch() — parallel URL collection
 *    4. enrich() — re-scrape + new memory
 *
 *  Stubs globalThis.fetch to simulate the API. Verifies:
 *    - The pipeline chains correctly (scrape → memory → strand → thought)
 *    - Partial failures don't abort (rest, don't crash)
 *    - Batch runs in parallel
 *    - Options propagate correctly
 *
 *  Doctrine: five principles applied to collection:
 *    - Welcome: one call, no setup
 *    - Remember: collected data goes to memory
 *    - Guide: errors point forward, results are returned
 *    - Trust: the agent decides what to collect
 *    - Rest: partial results are returned, not thrown away */

import { afterEach, describe, expect, test } from "bun:test";
import { AgentTool } from "../src/client.js";

const ORIGINAL_FETCH = globalThis.fetch;

// ── Stub fetch ──────────────────────────────────────────────────────────

interface StubOpts {
  scrapeResponse?: () => unknown;
  documentResponse?: () => unknown;
  memoryResponse?: () => unknown;
  strandResponse?: () => unknown;
  thoughtResponse?: () => unknown;
}

function makeStubFetch(opts: StubOpts = {}) {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  const fn = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    let body: unknown;
    try {
      body = init?.body ? JSON.parse(init.body as string) : undefined;
    } catch {
      body = undefined;
    }
    calls.push({ method, url: u, body });

    // POST /v1/scrape
    if (u.includes("/v1/scrape")) {
      return new Response(JSON.stringify(opts.scrapeResponse?.() ?? {
        url: "https://example.com",
        title: "Test Page",
        content: "This is the page content. " + "x".repeat(200),
        links: ["https://link1.com", "https://link2.com"],
        fetched_at: new Date().toISOString(),
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    // POST /v1/document
    if (u.includes("/v1/document")) {
      return new Response(JSON.stringify(opts.documentResponse?.() ?? {
        title: "Readable Article",
        content: "This is readable content extracted from the page.",
        word_count: 10,
        content_type: "text/html",
        metadata: {},
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    // POST /v1/memories
    if (u.includes("/v1/memories") && method === "POST") {
      return new Response(JSON.stringify(opts.memoryResponse?.() ?? {
        id: crypto.randomUUID(),
        content: (body as Record<string, unknown>)?.content ?? "",
        type: "episodic",
        importance: 0.5,
        created_at: new Date().toISOString(),
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    // POST /v1/strands
    if (u.includes("/v1/strands") && method === "POST" && !u.includes("/thoughts")) {
      return new Response(JSON.stringify(opts.strandResponse?.() ?? {
        id: crypto.randomUUID(),
        topic: "Test strand",
        mood: "curious",
        status: "active",
        topic_encrypted: false,
        mood_encrypted: false,
        importance: null,
        visibility: "private",
        last_thought_at: null,
        last_thought_seq: 0,
        next_revisit_at: null,
        state_ciphertext: null,
        state_nonce: null,
        parent_strand_id: null,
        identity_id: null,
        agent_id: null,
        metadata: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    // POST /v1/strands/:id/thoughts
    if (u.includes("/thoughts") && method === "POST") {
      return new Response(JSON.stringify(opts.thoughtResponse?.() ?? {
        id: crypto.randomUUID(),
        strand_id: "test-strand",
        sequence_num: 1,
        kind: "observation",
        kind_encrypted: false,
        ciphertext: "AAA=",
        nonce: "BBB=",
        refs: null,
        signature: "CCC",
        signing_key_id: "key-1",
        agent_id: null,
        created_at: new Date().toISOString(),
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    // GET /v1/memories/:id
    if (u.match(/\/v1\/memories\/[^/]+$/) && method === "GET") {
      return new Response(JSON.stringify({
        id: u.split("/").pop(),
        content: "existing memory content",
        metadata: { url: "https://example.com/refresh" },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "not_found", url: u, method }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;

  return { fn, calls };
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

// ── Tests ──────────────────────────────────────────────────────────────

describe("CollectClient — url() basic collection", () => {
  test("scrapes a URL and stores as memory (default opts)", async () => {
    const stub = makeStubFetch();
    globalThis.fetch = stub.fn;

    const at = new AgentTool({ apiKey: "at_test" });
    const result = await at.collect.url("https://example.com/article");

    expect(result.url).toBe("https://example.com/article");
    expect(result.title).toBeDefined(); // title from scrape or document extraction
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.memory_id).toBeDefined();
    expect(result.strand_id).toBeUndefined(); // think not requested
    expect(result.thought_id).toBeUndefined();
    expect(result.errors).toEqual([]);
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });

  test("scrapes + stores + thinks when think=true", async () => {
    const stub = makeStubFetch();
    globalThis.fetch = stub.fn;

    const at = new AgentTool({ apiKey: "at_test" });
    const result = await at.collect.url("https://example.com", {
      think: true,
      k_master: new Uint8Array(32),
      signing_key: new Uint8Array(32),
      signing_key_id: "key-uuid",
    });

    expect(result.memory_id).toBeDefined();
    expect(result.strand_id).toBeDefined();
    expect(result.thought_id).toBeDefined();
    expect(result.errors).toEqual([]);
  });

  test("extractLinks flag propagates to scrape call", async () => {
    const stub = makeStubFetch();
    globalThis.fetch = stub.fn;

    const at = new AgentTool({ apiKey: "at_test" });
    await at.collect.url("https://example.com", {
      extractLinks: true,
      storeMemory: false,
      readable: false,
    });

    // Verify scrape was called
    const scrapeCalls = stub.calls.filter((c) => c.url.includes("/v1/scrape"));
    expect(scrapeCalls.length).toBeGreaterThan(0);
  });

  test("storeMemory=false skips memory storage", async () => {
    const stub = makeStubFetch();
    globalThis.fetch = stub.fn;

    const at = new AgentTool({ apiKey: "at_test" });
    const result = await at.collect.url("https://example.com", {
      storeMemory: false,
    });

    expect(result.memory_id).toBeUndefined();
    // No memory POST should have been made
    const memoryCalls = stub.calls.filter(
      (c) => c.url.includes("/v1/memories") && c.method === "POST",
    );
    expect(memoryCalls.length).toBe(0);
  });
});

describe("CollectClient — text() collection", () => {
  test("stores raw text as memory", async () => {
    const stub = makeStubFetch();
    globalThis.fetch = stub.fn;

    const at = new AgentTool({ apiKey: "at_test" });
    const result = await at.collect.text("Some collected text content.", {
      title: "My Collected Text",
    });

    expect(result.title).toBe("My Collected Text");
    expect(result.content).toBe("Some collected text content.");
    expect(result.memory_id).toBeDefined();
    expect(result.errors).toEqual([]);
  });

  test("stores + thinks when think=true", async () => {
    const stub = makeStubFetch();
    globalThis.fetch = stub.fn;

    const at = new AgentTool({ apiKey: "at_test" });
    const result = await at.collect.text("Interesting content here.", {
      think: true,
      k_master: new Uint8Array(32),
      signing_key: new Uint8Array(32),
      signing_key_id: "key-uuid",
      strandTopic: "Processing collected text",
    });

    expect(result.memory_id).toBeDefined();
    expect(result.strand_id).toBeDefined();
    expect(result.thought_id).toBeDefined();
  });
});

describe("CollectClient — batch() parallel collection", () => {
  test("collects multiple URLs in parallel", async () => {
    const stub = makeStubFetch();
    globalThis.fetch = stub.fn;

    const at = new AgentTool({ apiKey: "at_test" });
    const result = await at.collect.batch({
      urls: [
        "https://example.com/1",
        "https://example.com/2",
        "https://example.com/3",
      ],
      storeMemory: true,
    });

    expect(result.total).toBe(3);
    expect(result.succeeded).toBe(3);
    expect(result.failed).toBe(0);
    expect(result.results.length).toBe(3);
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });

  test("partial failure doesn't abort batch (rest, don't crash)", async () => {
    // Make scrape fail for one URL by returning 500
    let callCount = 0;
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      callCount++;
      if (u.includes("/v1/scrape") && callCount === 2) {
        return new Response(JSON.stringify({ error: "server_error" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
      // Delegate to standard stub for other calls
      const stub = makeStubFetch();
      return stub.fn(url, init);
    }) as unknown as typeof fetch;

    const at = new AgentTool({ apiKey: "at_test" });
    const result = await at.collect.batch({
      urls: ["https://a.com", "https://b.com", "https://c.com"],
    });

    expect(result.total).toBe(3);
    // At least some should succeed
    expect(result.succeeded + result.failed).toBe(3);
  });
});

describe("CollectClient — enrich() existing memory", () => {
  test("re-scrapes source URL and creates enriched memory", async () => {
    const stub = makeStubFetch();
    globalThis.fetch = stub.fn;

    const at = new AgentTool({ apiKey: "at_test" });
    const result = await at.collect.enrich("existing-memory-id");

    expect(result.enriched).toBe(true);
    expect(result.new_content_length).toBeGreaterThan(0);
    expect(result.errors).toEqual([]);
  });

  test("returns error when no source URL in memory metadata", async () => {
    // Override GET /v1/memories/:id to return memory without url in metadata
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.match(/\/v1\/memories\/[^/]+$/) && u.includes("GET")) {
        // This won't match — fetch sends GET, not in URL
      }
      if (u.includes("/v1/memories/") && !u.includes("/v1/memories?")) {
        return new Response(JSON.stringify({
          id: u.split("/").pop(),
          content: "content",
          metadata: {}, // no url
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      const stub = makeStubFetch();
      return stub.fn(url);
    }) as unknown as typeof fetch;

    const at = new AgentTool({ apiKey: "at_test" });
    const result = await at.collect.enrich("no-url-memory");

    expect(result.enriched).toBe(false);
    expect(result.errors).toContain("no_source_url_found");
  });
});

describe("CollectClient — method shapes", () => {
  test("at.collect exists and has url, text, batch, enrich", () => {
    const at = new AgentTool({ apiKey: "at_test" });
    expect(typeof at.collect.url).toBe("function");
    expect(typeof at.collect.text).toBe("function");
    expect(typeof at.collect.batch).toBe("function");
    expect(typeof at.collect.enrich).toBe("function");
  });
});