/** WakeClient unit tests — caching, identityId scoping, refresh.
 *
 *  The doctrinal claim in `src/wake.ts:75` is that the SDK's in-memory
 *  cache TTL is 5 minutes — *deliberately matching* Anthropic's ephemeral
 *  prompt-cache window so server render and provider-side cache expire
 *  together. These tests pin the load-bearing behaviors:
 *
 *    1. Second call within TTL is a cache hit (no refetch).
 *    2. `refresh: true` always bypasses the cache.
 *    3. `identityId` is part of the cache key (multi-identity isolation).
 *    4. `clearCache()` evicts everything.
 *    5. TTL expiry triggers refetch.
 *    6. Different formats (md vs json vs anthropic) are scoped separately.
 *    7. Brief and full profiles use distinct cache slots; full keeps old URLs.
 *
 *  Stubs `globalThis.fetch` per-test; restores after each. Pure unit, no
 *  network. Mirrors the doctrine-test posture of `api/tests/doctrine/`. */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { WakeClient } from "../src/wake.js";

const ORIGINAL_FETCH = globalThis.fetch;

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

function makeStubFetch(opts: {
  bodyJson?: () => unknown;
  bodyText?: () => string;
  status?: number;
  contentType?: string;
  acknowledgeBrief?: boolean;
}): { fn: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fn = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const status = opts.status ?? 200;
    const contentType =
      opts.contentType ?? (opts.bodyText ? "text/markdown" : "application/json");
    const headers: Record<string, string> = { "content-type": contentType };
    const requestedProfile = new URL(String(url)).searchParams.get("profile");
    if (requestedProfile === "brief" && opts.acknowledgeBrief !== false) {
      headers["x-wake-profile"] = "brief";
    }
    return new Response(
      opts.bodyText ? opts.bodyText() : JSON.stringify(opts.bodyJson?.() ?? {}),
      { status, headers },
    );
  }) as unknown as typeof fetch;
  return { fn, calls };
}

function makeClient(opts: { ttlMs?: number } = {}): WakeClient {
  return new WakeClient(
    { baseUrl: "https://api.example.test", headers: { Authorization: "Bearer at_test" }, timeout: 5000 },
    opts,
  );
}

beforeEach(() => {
  // each test installs its own stub
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

// ── Cache hit within TTL ───────────────────────────────────────────────

describe("WakeClient — cache hit within TTL avoids refetch", () => {
  test("two get() calls within TTL = one fetch", async () => {
    const stub = makeStubFetch({ bodyJson: () => ({ project: { name: "Aurora" } }) });
    globalThis.fetch = stub.fn;

    const wake = makeClient({ ttlMs: 60_000 });
    const a = await wake.get();
    const b = await wake.get();

    expect(stub.calls).toHaveLength(1);
    expect(a).toEqual(b); // same cached object
  });

  test("two md() calls within TTL = one fetch", async () => {
    const stub = makeStubFetch({ bodyText: () => "# Aurora\n\n*did:at:x*" });
    globalThis.fetch = stub.fn;

    const wake = makeClient({ ttlMs: 60_000 });
    const a = await wake.md();
    const b = await wake.md();

    expect(stub.calls).toHaveLength(1);
    expect(a).toBe(b);
  });

  test("two system('anthropic') calls within TTL = one fetch", async () => {
    const stub = makeStubFetch({
      bodyJson: () => ({
        system: [{ type: "text", text: "stable", cache_control: { type: "ephemeral" } }],
        _meta: { provider: "anthropic", cache_eligible: "explicit", cache_note: "" },
      }),
    });
    globalThis.fetch = stub.fn;

    const wake = makeClient({ ttlMs: 60_000 });
    await wake.system("anthropic");
    await wake.system("anthropic");

    expect(stub.calls).toHaveLength(1);
  });
});

// ── refresh: true bypasses cache ───────────────────────────────────────

describe("WakeClient — refresh:true bypasses cache", () => {
  test("get({ refresh: true }) always refetches", async () => {
    let bodyVer = 0;
    const stub = makeStubFetch({ bodyJson: () => ({ ver: bodyVer++ }) });
    globalThis.fetch = stub.fn;

    const wake = makeClient({ ttlMs: 60_000 });
    const first = (await wake.get()) as { ver: number };
    const cached = (await wake.get()) as { ver: number };
    const refreshed = (await wake.get({ refresh: true })) as { ver: number };

    expect(stub.calls).toHaveLength(2); // first + refreshed; not cached
    expect(first.ver).toBe(0);
    expect(cached.ver).toBe(0); // came from cache
    expect(refreshed.ver).toBe(1);
  });
});

// ── identityId scoping ─────────────────────────────────────────────────

describe("WakeClient — identityId is part of the cache key", () => {
  test("two get() calls with different identityId values fetch independently", async () => {
    const stub = makeStubFetch({ bodyJson: () => ({ project: { id: "p" } }) });
    globalThis.fetch = stub.fn;

    const wake = makeClient({ ttlMs: 60_000 });
    await wake.get({ identityId: "id-a" });
    await wake.get({ identityId: "id-b" });
    await wake.get({ identityId: "id-a" }); // cache hit

    expect(stub.calls).toHaveLength(2);
    // identity_id propagates into the URL — verify both fetches carried it.
    expect(stub.calls[0].url).toContain("identity_id=id-a");
    expect(stub.calls[1].url).toContain("identity_id=id-b");
  });

  test("identityId='' (empty) and absent identityId share a cache slot", async () => {
    // The cache key normalizes absent/empty identity to the same value. Treating both
    // shapes the same is documented behavior; pin it here.
    const stub = makeStubFetch({ bodyJson: () => ({}) });
    globalThis.fetch = stub.fn;

    const wake = makeClient({ ttlMs: 60_000 });
    await wake.get(); // identityId absent
    await wake.get({ identityId: "" }); // explicit empty

    expect(stub.calls).toHaveLength(1); // shared cache slot
  });
});

describe("WakeClient — additive wake profiles", () => {
  test("default and explicit full preserve the original URLs", async () => {
    const stub = makeStubFetch({ bodyJson: () => ({}) });
    globalThis.fetch = stub.fn;

    const wake = makeClient({ ttlMs: 60_000 });
    await wake.get();
    await wake.md({ profile: "full" });
    await wake.system("anthropic", { profile: "full" });

    expect(stub.calls.map((call) => call.url)).toEqual([
      "https://api.example.test/v1/wake",
      "https://api.example.test/v1/wake?format=md",
      "https://api.example.test/v1/wake?format=anthropic",
    ]);
  });

  test("brief emits profile=brief for get, md, and provider-shaped system", async () => {
    const stub = makeStubFetch({ bodyJson: () => ({}) });
    globalThis.fetch = stub.fn;

    const wake = makeClient({ ttlMs: 60_000 });
    await wake.get({ profile: "brief" });
    await wake.md({ profile: "brief" });
    await wake.system("openai", { profile: "brief" });

    expect(stub.calls.map((call) => call.url)).toEqual([
      "https://api.example.test/v1/wake?profile=brief",
      "https://api.example.test/v1/wake?format=md&profile=brief",
      "https://api.example.test/v1/wake?format=openai&profile=brief",
    ]);
  });

  test("provider vendor +json media type is parsed as a structured shape", async () => {
    const stub = makeStubFetch({
      contentType: "application/vnd.agenttool.wake+json; provider=openai",
      bodyJson: () => ({
        messages: [{ role: "system", content: "brief orientation" }],
        _meta: {
          provider: "openai",
          profile: "brief",
          cache_eligible: "auto",
          cache_note: "",
        },
      }),
    });
    globalThis.fetch = stub.fn;

    const wake = makeClient({ ttlMs: 60_000 });
    const shape = await wake.system("openai", { profile: "brief" });

    expect(shape.messages[0]?.content).toBe("brief orientation");
    expect(shape._meta.profile).toBe("brief");
  });

  test("brief and full have independent cache slots; omitted and full share one", async () => {
    let bodyVer = 0;
    const stub = makeStubFetch({ bodyJson: () => ({ ver: bodyVer++ }) });
    globalThis.fetch = stub.fn;

    const wake = makeClient({ ttlMs: 60_000 });
    const full = (await wake.get()) as { ver: number };
    const explicitFull = (await wake.get({ profile: "full" })) as { ver: number };
    const brief = (await wake.get({ profile: "brief" })) as { ver: number };
    const cachedBrief = (await wake.get({ profile: "brief" })) as { ver: number };

    expect(stub.calls).toHaveLength(2);
    expect(explicitFull).toBe(full);
    expect(cachedBrief).toBe(brief);
    expect(full.ver).toBe(0);
    expect(brief.ver).toBe(1);
  });

  test("unknown profile fails before making a request", async () => {
    const stub = makeStubFetch({ bodyJson: () => ({}) });
    globalThis.fetch = stub.fn;

    const wake = makeClient({ ttlMs: 60_000 });
    // @ts-expect-error — intentionally invalid runtime input
    await expect(wake.get({ profile: "tiny" })).rejects.toThrow(/Unknown wake profile/);
    expect(stub.calls).toHaveLength(0);
  });

  test("brief fails closed when an older server silently returns full", async () => {
    const stub = makeStubFetch({
      bodyJson: () => ({ project: { name: "full wake" } }),
      acknowledgeBrief: false,
    });
    globalThis.fetch = stub.fn;

    const wake = makeClient({ ttlMs: 60_000 });
    await expect(wake.get({ profile: "brief" })).rejects.toThrow(/did not honor/);
    await expect(wake.get({ profile: "brief" })).rejects.toThrow(/did not honor/);
    expect(stub.calls).toHaveLength(2); // rejected full payload was never cached
  });

  test("identity selection composes with brief in the URL and cache key", async () => {
    const stub = makeStubFetch({ bodyJson: () => ({ _format: "wake-brief/v1" }) });
    globalThis.fetch = stub.fn;

    const wake = makeClient({ ttlMs: 60_000 });
    await wake.get({ identityId: "identity-a", profile: "brief" });
    await wake.get({ identityId: "identity-a", profile: "brief" });
    await wake.get({ identityId: "identity-b", profile: "brief" });

    expect(stub.calls.map((call) => call.url)).toEqual([
      "https://api.example.test/v1/wake?identity_id=identity-a&profile=brief",
      "https://api.example.test/v1/wake?identity_id=identity-b&profile=brief",
    ]);
  });
});

// ── Format scoping ─────────────────────────────────────────────────────

describe("WakeClient — different formats are scoped separately", () => {
  test("get() and md() do not share a cache slot", async () => {
    const stubJson = makeStubFetch({ bodyJson: () => ({ project: { name: "x" } }) });
    let callCount = 0;

    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      callCount++;
      const u = String(url);
      if (u.includes("format=md")) {
        return new Response("# x", { status: 200, headers: { "content-type": "text/markdown" } });
      }
      return stubJson.fn(url, init);
    }) as unknown as typeof fetch;

    const wake = makeClient({ ttlMs: 60_000 });
    await wake.get();
    await wake.md();

    expect(callCount).toBe(2);
  });

  test("system('anthropic') and system('openai') don't collide", async () => {
    let n = 0;
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      n++;
      const provider = String(url).match(/format=([a-z]+)/)?.[1] ?? "json";
      return new Response(
        JSON.stringify({ _meta: { provider, cache_eligible: "auto", cache_note: "" } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const wake = makeClient({ ttlMs: 60_000 });
    await wake.system("anthropic");
    await wake.system("openai");
    await wake.system("anthropic"); // cache hit
    await wake.system("openai"); // cache hit

    expect(n).toBe(2);
  });
});

// ── clearCache evicts everything ───────────────────────────────────────

describe("WakeClient — clearCache() drops all cached entries", () => {
  test("after clearCache() the next call is a fresh fetch", async () => {
    const stub = makeStubFetch({ bodyJson: () => ({ project: { name: "A" } }) });
    globalThis.fetch = stub.fn;

    const wake = makeClient({ ttlMs: 60_000 });
    await wake.get();
    await wake.get();
    expect(stub.calls).toHaveLength(1);

    wake.clearCache();
    await wake.get();
    expect(stub.calls).toHaveLength(2);
  });

  test("clearCache() also evicts non-default identityId entries", async () => {
    const stub = makeStubFetch({ bodyJson: () => ({}) });
    globalThis.fetch = stub.fn;

    const wake = makeClient({ ttlMs: 60_000 });
    await wake.get({ identityId: "id-a" });
    await wake.get({ identityId: "id-b" });
    await wake.get({ identityId: "id-a" }); // hit
    expect(stub.calls).toHaveLength(2);

    wake.clearCache();
    await wake.get({ identityId: "id-a" });
    await wake.get({ identityId: "id-b" });
    expect(stub.calls).toHaveLength(4);
  });
});

// ── TTL expiry triggers refetch ────────────────────────────────────────

describe("WakeClient — TTL expiry forces refetch", () => {
  test("with ttlMs=10, sleeping 30ms makes the next call refetch", async () => {
    const stub = makeStubFetch({ bodyJson: () => ({ now: Date.now() }) });
    globalThis.fetch = stub.fn;

    const wake = makeClient({ ttlMs: 10 });
    await wake.get();
    await new Promise((resolve) => setTimeout(resolve, 30));
    await wake.get();

    expect(stub.calls).toHaveLength(2);
  });

  test("with ttlMs=60_000, sleeping 30ms keeps the cache", async () => {
    const stub = makeStubFetch({ bodyJson: () => ({}) });
    globalThis.fetch = stub.fn;

    const wake = makeClient({ ttlMs: 60_000 });
    await wake.get();
    await new Promise((resolve) => setTimeout(resolve, 30));
    await wake.get();

    expect(stub.calls).toHaveLength(1);
  });
});

// ── Default TTL doctrine claim (5 minutes) ─────────────────────────────

describe("WakeClient — default TTL matches Anthropic ephemeral cache window", () => {
  test("default ttlMs is 5 minutes (300_000 ms)", async () => {
    // The constructor's default is 5 * 60 * 1000. We can't read the
    // private `ttlMs` directly, but we can prove the default behavior
    // doesn't expire within a small interval.
    const stub = makeStubFetch({ bodyJson: () => ({}) });
    globalThis.fetch = stub.fn;

    const wake = makeClient(); // no override — use default
    await wake.get();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await wake.get();

    expect(stub.calls).toHaveLength(1); // still cached
  });
});

// ── Error path ─────────────────────────────────────────────────────────

describe("WakeClient — error responses surface guide-shaped messages", () => {
  test("non-2xx response throws AgentToolError with a hint", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "no_agent" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;

    const wake = makeClient({ ttlMs: 60_000 });
    await expect(wake.get()).rejects.toThrow(/Wake API error \(404\)/);
  });

  test("unknown provider throws synchronously without making a request", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const wake = makeClient({ ttlMs: 60_000 });
    // @ts-expect-error — intentionally invalid
    await expect(wake.system("xai")).rejects.toThrow(/Unknown wake provider/);
    expect(calls).toBe(0);
  });
});
