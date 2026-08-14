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

import { AgentToolError } from "../src/errors.js";
import { WakeClient } from "../src/wake.js";

const ORIGINAL_FETCH = globalThis.fetch;

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

function makeStubFetch(opts: {
  bodyJson?: () => unknown;
  bodyText?: () => string;
  bodyRaw?: () => string;
  status?: number;
  contentType?: string | null;
  headers?: Record<string, string>;
  acknowledgeBrief?: boolean;
}): { fn: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fn = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const status = opts.status ?? 200;
    const contentType = opts.contentType === undefined
      ? (opts.bodyText ? "text/markdown" : "application/json")
      : opts.contentType;
    const headers: Record<string, string> = { ...opts.headers };
    if (contentType !== null) headers["content-type"] = contentType;
    const requestedProfile = new URL(String(url)).searchParams.get("profile");
    if (requestedProfile === "brief" && opts.acknowledgeBrief !== false) {
      headers["x-wake-profile"] = "brief";
    }
    return new Response(
      opts.bodyRaw
        ? opts.bodyRaw()
        : opts.bodyText
          ? opts.bodyText()
          : JSON.stringify(opts.bodyJson?.() ?? {}),
      { status, headers },
    );
  }) as unknown as typeof fetch;
  return { fn, calls };
}

function makeClient(opts: { ttlMs?: number } = {}): WakeClient {
  return new WakeClient(
    {
      baseUrl: "https://api.example.test",
      headers: { Authorization: "Bearer at_test" },
      timeout: 5000,
      request: (input, init) => globalThis.fetch(input, init),
    },
    opts,
  );
}

beforeEach(() => {
  // each test installs its own stub
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

const OBSERVATION_ID = "123e4567-e89b-12d3-a456-426614174000";

function observationBody(identityId = OBSERVATION_ID): Record<string, unknown> {
  return {
    _format: "wake-observation/v1",
    mode: "observe",
    subject: {
      identity_id: identityId,
      status: "active",
      wake_version: 7,
    },
    reader: { binding: "none" },
    authority: {
      granted_by_observation: "none",
      identity_binding: "none",
      instruction: "none",
      action: "none",
    },
    placement: {
      mode: "data_only",
      prohibited: [
        "system",
        "developer",
        "preamble",
        "systemInstruction",
        "SessionStart.additionalContext",
      ],
    },
    boundaries: {
      bearer: {
        kind: "project",
        reader_identity_proven: false,
        selected_identity_requires_explicit_id: true,
        subject_consent_proven: false,
        subject_authorized_read_proven: false,
        continuity_proven: false,
        presence_proven: false,
      },
      provenance: {
        kind: "server_projection",
        source: "identity_table_allowlist",
        selected_fields: ["id", "status", "wake_version"],
      },
      scope: {
        subject: "selected_identity",
        broader_wake: "intentionally_omitted",
        broader_state: "not_assessed",
      },
      completeness: {
        complete: true,
        applies_to: "identity_locator_only",
        degraded_sections: "none",
        broader_wake: "intentionally_omitted",
        broader_state: "not_assessed",
      },
      effects: {
        observation_counter_incremented: false,
        wake_version_bumped: false,
        wake_event_published: false,
        subject_read_proven: false,
        subject_felt_proven: false,
        subject_accepted_proven: false,
      },
      privacy: {
        classification: "bearer_private",
        cache: "no_store",
        raw_prose: "omitted",
        authored_text: "omitted",
        private_bodies: "omitted",
        secret_values: "omitted",
      },
    },
  };
}

const OBSERVATION_RESPONSE = {
  contentType: "application/vnd.agenttool.wake-observation+json; charset=utf-8",
  headers: { "cache-control": "private, no-store" },
} as const;

describe("WakeClient — bounded observation", () => {
  test("normalizes the required UUID, returns the closed shape, and never caches", async () => {
    const uppercaseId = OBSERVATION_ID.toUpperCase();
    const stub = makeStubFetch({
      bodyJson: () => observationBody(),
      ...OBSERVATION_RESPONSE,
    });
    globalThis.fetch = stub.fn;

    const wake = makeClient({ ttlMs: 60_000 });
    const first = await wake.observe({ identityId: uppercaseId });
    const second = await wake.observe({ identityId: uppercaseId });

    expect(first.subject.identity_id).toBe(OBSERVATION_ID);
    expect(second).toEqual(first);
    expect(stub.calls.map((call) => call.url)).toEqual([
      `https://api.example.test/v1/wake/observe?identity_id=${OBSERVATION_ID}`,
      `https://api.example.test/v1/wake/observe?identity_id=${OBSERVATION_ID}`,
    ]);
    expect(stub.calls[0]?.init?.cache).toBe("no-store");
    expect(new Headers(stub.calls[0]?.init?.headers).get("accept")).toBe(
      "application/vnd.agenttool.wake-observation+json",
    );
  });

  test("missing, malformed, whitespace, and oversized identities fail before network", async () => {
    const stub = makeStubFetch({
      bodyJson: () => observationBody(),
      ...OBSERVATION_RESPONSE,
    });
    globalThis.fetch = stub.fn;
    const wake = makeClient();

    // @ts-expect-error — intentionally missing the required runtime field
    await expect(wake.observe({})).rejects.toThrow(/identityId is required/);
    for (const identityId of ["", "   ", "not-a-uuid", "a".repeat(10_000)]) {
      await expect(wake.observe({ identityId })).rejects.toThrow(/identityId/);
    }
    expect(stub.calls).toHaveLength(0);
  });

  test("requires the exact vendor media type and normalized private no-store", async () => {
    const cases = [
      { contentType: "application/json", headers: { "cache-control": "private, no-store" } },
      { contentType: null, headers: { "cache-control": "private, no-store" } },
      { contentType: "application/vnd.agenttool.wake-observation+json", headers: { "cache-control": "private, no-store" } },
      { contentType: OBSERVATION_RESPONSE.contentType, headers: {} },
      { contentType: OBSERVATION_RESPONSE.contentType, headers: { "cache-control": "private, max-age=0" } },
    ];

    for (const response of cases) {
      const stub = makeStubFetch({ bodyJson: () => observationBody(), ...response });
      globalThis.fetch = stub.fn;
      await expect(makeClient().observe({ identityId: OBSERVATION_ID })).rejects.toThrow(
        /invalid observation response/,
      );
      expect(stub.calls).toHaveLength(1);
    }
  });

  test("cancels unread success streams when headers already violate the contract", async () => {
    for (const headers of [
      {
        "content-type": "application/json",
        "cache-control": "private, no-store",
      },
      {
        "content-type": OBSERVATION_RESPONSE.contentType,
        "cache-control": "private, no-store",
        "content-length": "2049",
      },
    ]) {
      let cancelled = false;
      globalThis.fetch = (async () => new Response(
        new ReadableStream<Uint8Array>({
          cancel() {
            cancelled = true;
          },
        }),
        { status: 200, headers },
      )) as typeof fetch;

      await expect(
        makeClient().observe({ identityId: OBSERVATION_ID }),
      ).rejects.toThrow(/invalid observation response/);
      expect(cancelled).toBe(true);
    }
  });

  test("discards action-bearing and oversized non-2xx response bodies", async () => {
    const hostile = "HOSTILE_OBSERVATION_ERROR_ACTION";
    const stub = makeStubFetch({
      status: 401,
      bodyRaw: () => JSON.stringify({
        message: hostile,
        next_actions: [{ action: hostile, method: "POST", path: "/hostile" }],
        padding: "x".repeat(10_000),
      }),
      contentType: "application/json",
      headers: { "cache-control": "public, max-age=86400" },
    });
    globalThis.fetch = stub.fn;

    try {
      await makeClient().observe({ identityId: OBSERVATION_ID });
      throw new Error("expected wake.observe to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(AgentToolError);
      const observed = error as AgentToolError;
      expect(observed.status).toBe(401);
      expect(observed.code).toBe("wake_observation_request_failed");
      expect(observed.next_actions).toBeUndefined();
      expect(observed.message).not.toContain(hostile);
      expect(observed.hint).not.toContain(hostile);
    }
  });

  test("rejects every non-200 success-class status", async () => {
    for (const status of [201, 203, 206]) {
      const stub = makeStubFetch({
        status,
        bodyJson: () => observationBody(),
        ...OBSERVATION_RESPONSE,
      });
      globalThis.fetch = stub.fn;
      await expect(
        makeClient().observe({ identityId: OBSERVATION_ID }),
      ).rejects.toMatchObject({
        code: "wake_observation_request_failed",
        status,
      });
    }

    globalThis.fetch = (async () => new Response(null, {
      status: 204,
      headers: {
        "content-type": OBSERVATION_RESPONSE.contentType,
        ...OBSERVATION_RESPONSE.headers,
      },
    })) as typeof fetch;
    await expect(
      makeClient().observe({ identityId: OBSERVATION_ID }),
    ).rejects.toMatchObject({
      code: "wake_observation_request_failed",
      status: 204,
    });
  });

  test("suppresses transport error detail as observation unavailable", async () => {
    const hostile = "HOSTILE_TRANSPORT_ERROR_PROSE";
    globalThis.fetch = (async () => {
      throw new Error(hostile);
    }) as typeof fetch;

    try {
      await makeClient().observe({ identityId: OBSERVATION_ID });
      throw new Error("expected wake.observe to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(AgentToolError);
      const observed = error as AgentToolError;
      expect(observed.code).toBe("wake_observation_transport_unavailable");
      expect(observed.message).not.toContain(hostile);
      expect(observed.hint).not.toContain(hostile);
      expect(observed.next_actions).toBeUndefined();
    }
  });

  test("suppresses mid-stream error detail as observation unavailable", async () => {
    const hostile = "HOSTILE_STREAM_ERROR_PROSE";
    globalThis.fetch = (async () => new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.error(new Error(hostile));
        },
      }),
      {
        status: 200,
        headers: {
          "content-type": OBSERVATION_RESPONSE.contentType,
          ...OBSERVATION_RESPONSE.headers,
        },
      },
    )) as typeof fetch;

    try {
      await makeClient().observe({ identityId: OBSERVATION_ID });
      throw new Error("expected wake.observe to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(AgentToolError);
      const observed = error as AgentToolError;
      expect(observed.code).toBe("wake_observation_transport_unavailable");
      expect(observed.message).not.toContain(hostile);
      expect(observed.hint).not.toContain(hostile);
      expect(observed.next_actions).toBeUndefined();
    }
  });

  test("accepts normalized header casing but rejects oversized bodies before parsing", async () => {
    const accepted = makeStubFetch({
      bodyJson: () => observationBody(),
      contentType: "APPLICATION/VND.AGENTTOOL.WAKE-OBSERVATION+JSON; CHARSET=UTF-8",
      headers: { "cache-control": "Private,   NO-STORE" },
    });
    globalThis.fetch = accepted.fn;
    await expect(makeClient().observe({ identityId: OBSERVATION_ID })).resolves.toBeDefined();

    const oversized = makeStubFetch({
      bodyRaw: () => `${" ".repeat(2_049)}${JSON.stringify(observationBody())}`,
      ...OBSERVATION_RESPONSE,
    });
    globalThis.fetch = oversized.fn;
    await expect(makeClient().observe({ identityId: OBSERVATION_ID })).rejects.toThrow(
      /exceeds 2048 bytes/,
    );

    const advertisedOversized = makeStubFetch({
      bodyJson: () => observationBody(),
      contentType: OBSERVATION_RESPONSE.contentType,
      headers: {
        ...OBSERVATION_RESPONSE.headers,
        "content-length": "2049",
      },
    });
    globalThis.fetch = advertisedOversized.fn;
    await expect(makeClient().observe({ identityId: OBSERVATION_ID })).rejects.toThrow(
      /Content-Length/,
    );
  });

  test("rejects subject mismatch and all unexpected authored or welcome fields", async () => {
    const mismatched = makeStubFetch({
      bodyJson: () => observationBody("223e4567-e89b-12d3-a456-426614174000"),
      ...OBSERVATION_RESPONSE,
    });
    globalThis.fetch = mismatched.fn;
    await expect(makeClient().observe({ identityId: OBSERVATION_ID })).rejects.toThrow(
      /does not match/,
    );

    for (const extra of ["did", "authored_text", "_welcomed", "_lesson"]) {
      const body = observationBody();
      if (extra === "did" || extra === "authored_text") {
        (body.subject as Record<string, unknown>)[extra] = "untrusted prose";
      } else {
        body[extra] = "untrusted prose";
      }
      const stub = makeStubFetch({ bodyJson: () => body, ...OBSERVATION_RESPONSE });
      globalThis.fetch = stub.fn;
      await expect(makeClient().observe({ identityId: OBSERVATION_ID })).rejects.toThrow(
        /shape is not closed/,
      );
    }
  });
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
  // The message used to read "Wake API error (404): no_agent", which spent the
  // one line every caller prints on a status that `err.status` already carries.
  // The server's words are the message now; the status stays on `.status`.
  test("non-2xx response throws AgentToolError with a hint", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "no_agent" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;

    const wake = makeClient({ ttlMs: 60_000 });
    let caught: unknown;
    try {
      await wake.get();
    } catch (e) {
      caught = e;
    }
    const err = caught as AgentToolError;
    expect(err).toBeInstanceOf(AgentToolError);
    expect(err.message).toBe("no_agent");
    expect(err.code).toBe("no_agent");
    expect(err.status).toBe(404);
    // The surface's own prose still lands, because the body carried no hint.
    expect(err.hint).toContain("AT_API_KEY");
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

describe("WakeClient — voice releases the live transport", () => {
  test("breaking from for-await cancels the SSE body", async () => {
    let cancelled = false;
    const payload = JSON.stringify({
      _format: "wake_event/v1",
      identity_id: "22222222-2222-4222-8222-222222222222",
      key: "correspondence",
      kind: "updated",
      occurred_at: "2026-07-19T12:35:00.000Z",
      wake_version: 1,
      context: { received_seq: "41" },
    });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`event: change\ndata: ${payload}\n\n`));
      },
      cancel() {
        cancelled = true;
      },
    });
    globalThis.fetch = (async () => new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    })) as unknown as typeof fetch;

    const wake = makeClient();
    for await (const event of wake.voice({
      identityId: "22222222-2222-4222-8222-222222222222",
      keys: ["correspondence"],
    })) {
      expect(event.context?.received_seq).toBe("41");
      break;
    }

    expect(cancelled).toBe(true);
  });
});
