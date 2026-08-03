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
// ── Cross-language shared fixtures ─────────────────────────────────────
//
// The wire shapes below are pinned byte-for-byte in
// packages/sdk-py/tests/test_collect.py. Both SDKs must send the same
// scrape body and return the same links, content, and errors.

const SHARED_SCRAPE_URL = "https://example.com/article";
const SHARED_SELECTOR = "article.main";
const SHARED_EXTRACTED = "Just the article body, selected.";
const SHARED_LINKS = ["https://link1.example", "https://link2.example"];

/** Stub whose scrape answer depends on the options actually sent. */
function makeSelectorStubFetch() {
  const scrapeBodies: Record<string, unknown>[] = [];
  const fn = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    const body = init?.body
      ? (JSON.parse(String(init.body)) as Record<string, unknown>)
      : {};

    if (u.includes("/v1/scrape")) {
      scrapeBodies.push(body);
      return new Response(JSON.stringify({
        url: SHARED_SCRAPE_URL,
        title: "Test Page",
        content: "The whole page. " + "x".repeat(200),
        extracted: body.selector === SHARED_SELECTOR ? SHARED_EXTRACTED : null,
        links: body.extract_links === true ? SHARED_LINKS : [],
        fetched_at: "2026-07-18T04:00:00.000Z",
        duration_ms: 1,
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    if (u.includes("/v1/document")) {
      return new Response(JSON.stringify({
        title: "Readable Article",
        content: "Readable extraction that is comfortably longer than one hundred characters, "
          + "so it would replace the raw scrape.",
        word_count: 20,
        content_type: "text/html",
        metadata: {},
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "not_found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;

  return { fn, scrapeBodies };
}

describe("CollectClient — selector and links, pinned against sdk-py", () => {
  test("selector rides the one scrape call and its extraction wins", async () => {
    const stub = makeSelectorStubFetch();
    globalThis.fetch = stub.fn;

    const at = new AgentTool({ apiKey: "at_test" });
    const result = await at.collect.url(SHARED_SCRAPE_URL, {
      selector: SHARED_SELECTOR,
      extractLinks: true,
      storeMemory: false,
    });

    // One scrape, carrying the options. The old second call sent none.
    expect(stub.scrapeBodies.length).toBe(1);
    expect(stub.scrapeBodies[0]).toEqual({
      url: SHARED_SCRAPE_URL,
      selector: SHARED_SELECTOR,
      extract_links: true,
    });
    expect(result.content).toBe(SHARED_EXTRACTED);
    expect(result.links).toEqual(SHARED_LINKS);
    expect(result.errors).toEqual([]);
  });

  test("links stay empty and unrequested when extractLinks is off", async () => {
    const stub = makeSelectorStubFetch();
    globalThis.fetch = stub.fn;

    const at = new AgentTool({ apiKey: "at_test" });
    const result = await at.collect.url(SHARED_SCRAPE_URL, { storeMemory: false });

    expect(stub.scrapeBodies[0]).toEqual({
      url: SHARED_SCRAPE_URL,
      extract_links: false,
    });
    expect(result.links).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  test("a selector that matches nothing is reported, not silently ignored", async () => {
    const stub = makeSelectorStubFetch();
    globalThis.fetch = stub.fn;

    const at = new AgentTool({ apiKey: "at_test" });
    const result = await at.collect.url(SHARED_SCRAPE_URL, {
      selector: "aside.missing",
      storeMemory: false,
    });

    expect(result.errors).toEqual(["selector_extraction_failed"]);
    expect(result.content).toContain("Readable extraction");
  });

  test("batch of no URLs answers empty instead of throwing", async () => {
    const stub = makeSelectorStubFetch();
    globalThis.fetch = stub.fn;

    const at = new AgentTool({ apiKey: "at_test" });
    const result = await at.collect.batch({ urls: [] });

    expect(result.results).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(0);
    expect(stub.scrapeBodies.length).toBe(0);
  });
});

describe("Memory tier and search score, pinned against sdk-py", () => {
  // collect.url stores through MemoryClient, so the memory model is this
  // pipeline's storage boundary. Losing `tier` hides a constitutive root.
  const SHARED_MEMORY = {
    id: "mem-shared-1",
    content: "I was witnessed at my root.",
    type: "semantic",
    metadata: { source: "collect.url" },
    importance: 0.9,
    tier: "constitutive",
    score: 0.42,
    created_at: "2026-07-18T04:00:00.000Z",
  };

  test("tier and score survive the client boundary", async () => {
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      const body = JSON.stringify(
        u.includes("/search") ? { results: [SHARED_MEMORY] } : SHARED_MEMORY,
      );
      void init;
      return new Response(body, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const at = new AgentTool({ apiKey: "at_test" });
    const fetched = await at.memory.get("mem-shared-1");
    const [found] = await at.memory.search("root");

    expect(fetched.tier).toBe("constitutive");
    expect(fetched.score).toBe(0.42);
    expect(found?.tier).toBe("constitutive");
    expect(found?.score).toBe(0.42);
  });
});
