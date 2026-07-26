import { describe, expect, test } from "bun:test";
import { SearchEngine } from "../src/engine.js";
import { SearchError } from "../src/errors.js";
import type {
  SearchKind,
  SearchProvider,
  ProviderCandidate,
  ProviderSearchBatch,
} from "../src/types.js";

function batch(
  providerId: string,
  results: readonly ProviderCandidate[],
  nextCursor?: string,
): ProviderSearchBatch {
  return {
    results,
    ...(nextCursor === undefined ? {} : { next_cursor: nextCursor }),
    observation: {
      request_url: `https://${providerId}.example/search?q=%5Bredacted%5D`,
      final_url: `https://${providerId}.example/search?q=%5Bredacted%5D`,
      status: 200,
      media_type: "application/json",
      bytes: 123,
      sha256: "a".repeat(64),
      boundary_codes: ["fixed_https_origin", "credentials_omitted"],
    },
  };
}

function candidate(
  title: string,
  targetUrl: string,
  kind: SearchKind = "agent",
): ProviderCandidate {
  return {
    kind,
    title,
    summary: `Remote summary for ${title}`,
    target_url: targetUrl,
    capabilities: ["search", "search"],
    claims: [
      {
        key: "publisher",
        value: "remote assertion",
        basis: "publisher_assertion",
      },
    ],
  };
}

function provider(
  id: string,
  search: SearchProvider["search"],
  kinds: readonly SearchKind[] = ["agent", "capability"],
): SearchProvider {
  return {
    id,
    kinds,
    boundary: {
      mode: "fixed_public_https_api",
      credentials: "omitted",
      query_disclosed: true,
      connected_address_pinning: false,
      statement: "The query is sent once to a fixed public HTTPS API.",
    },
    search,
  };
}

function ids() {
  let next = 0;
  return () => `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`;
}

describe("SearchEngine", () => {
  test("fuses exact URL matches while keeping raw targets process-private", async () => {
    const providers = [
      provider("alpha", async () =>
        batch("alpha", [
          candidate("Alpha only", "https://one.example/"),
          candidate(
            "Shared from alpha",
            "https://shared.example/tool?token=secret#details",
          ),
        ]),
      ),
      provider("beta", async () =>
        batch("beta", [
          candidate("Beta only", "https://two.example/"),
          candidate(
            "Shared from beta",
            "https://shared.example/tool?token=secret#other-fragment",
          ),
        ]),
      ),
    ];
    const engine = new SearchEngine(providers, {
      sessionId: "session-test",
      randomUUID: ids(),
      now: () => new Date("2026-07-26T10:00:00.000Z"),
    });

    const response = await engine.search({ query: "find an agent" });

    expect(response.status).toBe("complete");
    expect(response.partial).toBe(false);
    expect(response.privacy.query_sent_to).toEqual(["alpha", "beta"]);
    expect(response.results[0]?.origin).toBe("https://shared.example");
    expect(response.results[0]?.rank.signals).toHaveLength(2);
    expect(response.results[0]?.display_url).toBe(
      "https://shared.example/tool?token=%5Bredacted%5D",
    );
    expect(JSON.stringify(response)).not.toContain("secret");
    expect(response.results[0]?.automatic_action).toBe("never");
    expect(response.results[0]?.followups.map((item) => item.operation)).toEqual([
      "agent_inspect",
      "browser_plan_result",
      "browser_open_result",
    ]);

    const handle = response.results[0];
    if (!handle) throw new Error("missing fixture result");
    expect(
      engine.resolveResult(response.session_id, handle.result_id).targetUrl,
    ).toContain("token=secret");
  });

  test("reports partial provider failure without leaking thrown details", async () => {
    const engine = new SearchEngine(
      [
        provider("working", async () =>
          batch("working", [candidate("Working", "https://good.example/")]),
        ),
        provider("broken", async () => {
          throw Object.assign(
            new Error("secret upstream body and internal hostname"),
            { code: "provider_network_error" },
          );
        }),
      ],
      { randomUUID: ids() },
    );

    const response = await engine.search({ query: "partial" });

    expect(response.status).toBe("partial");
    expect(response.partial).toBe(true);
    expect(response.results).toHaveLength(1);
    expect(response.providers.find((item) => item.provider_id === "broken"))
      .toMatchObject({
        state: "error",
        result_count: 0,
        diagnostic_codes: ["provider_network_error"],
      });
    expect(JSON.stringify(response)).not.toContain("secret upstream");
  });

  test("does not expose extension-provider exception codes", async () => {
    const engine = new SearchEngine(
      [
        provider("custom", async () => {
          throw Object.assign(new Error("private provider detail"), {
            code: "private_token_abc123",
          });
        }),
      ],
      { randomUUID: ids() },
    );

    const response = await engine.search({ query: "private code" });

    expect(response.providers[0]?.diagnostic_codes).toEqual([
      "provider_unavailable",
    ]);
    expect(JSON.stringify(response)).not.toContain("private_token");
    expect(JSON.stringify(response)).not.toContain("private provider detail");
  });

  test("keeps provider cursors behind a session-scoped opaque cursor", async () => {
    const seen: Array<string | undefined> = [];
    const engine = new SearchEngine(
      [
        provider("paged", async (request) => {
          seen.push(request.cursor);
          return batch(
            "paged",
            [
              candidate(
                request.cursor ? "Second page" : "First page",
                request.cursor
                  ? "https://page-two.example/"
                  : "https://page-one.example/",
              ),
            ],
            request.cursor ? undefined : "provider-cursor-secret",
          );
        }),
      ],
      { sessionId: "session-paged", randomUUID: ids() },
    );

    const first = await engine.search({ query: "pages", limit: 1 });
    expect(first.next_cursor).toStartWith("search_cursor_");
    expect(JSON.stringify(first)).not.toContain("provider-cursor-secret");
    if (!first.next_cursor) throw new Error("missing fixture cursor");

    const second = await engine.search({ cursor: first.next_cursor });
    expect(second.query_id).toBe(first.query_id);
    expect(second.next_cursor).toBeNull();
    expect(second.results[0]?.title).toBe("Second page");
    expect(seen).toEqual([undefined, "provider-cursor-secret"]);

    await expect(
      engine.search({ cursor: first.next_cursor }),
    ).rejects.toMatchObject({ code: "cursor_not_found" });
    expect(seen).toEqual([undefined, "provider-cursor-secret"]);
  });

  test("drops provider scores whose basis sanitizes to empty", async () => {
    const scored = candidate("Scored", "https://score.example/");
    scored.provider_score = { value: 0.9, basis: "\u0001\u0002" };
    const engine = new SearchEngine(
      [provider("scored", async () => batch("scored", [scored]))],
      { randomUUID: ids() },
    );

    const response = await engine.search({ query: "score" });

    expect(response.results[0]?.rank.signals[0]?.provider_score).toBeNull();
  });

  test("enforces session ownership and result expiry", async () => {
    let now = new Date("2026-07-26T10:00:00.000Z");
    const engine = new SearchEngine(
      [
        provider("single", async () =>
          batch("single", [candidate("One", "https://one.example/")]),
        ),
      ],
      {
        sessionId: "owned-session",
        randomUUID: ids(),
        now: () => now,
        limits: { session_ttl_ms: 100 },
      },
    );
    const response = await engine.search({ query: "one" });
    const resultId = response.results[0]?.result_id;
    if (!resultId) throw new Error("missing fixture result");

    expect(() => engine.resolveResult("another-session", resultId)).toThrow(
      SearchError,
    );
    now = new Date("2026-07-26T10:00:00.101Z");
    expect(() => engine.resolveResult("owned-session", resultId)).toThrow(
      "Search result has expired.",
    );
  });

  test("bounds providers that ignore abort signals", async () => {
    const engine = new SearchEngine(
      [
        provider(
          "hanging",
          () => new Promise<ProviderSearchBatch>(() => undefined),
        ),
      ],
      {
        randomUUID: ids(),
        limits: {
          default_deadline_ms: 10,
          max_deadline_ms: 20,
        },
      },
    );

    const response = await engine.search({ query: "deadline" });

    expect(response.status).toBe("inconclusive");
    expect(response.providers[0]?.state).toBe("timeout");
    expect(response.diagnostics[0]?.code).toBe("provider_timeout");
  });

  test("does not disclose a pre-cancelled query to providers", async () => {
    let calls = 0;
    const engine = new SearchEngine(
      [
        provider("single", async () => {
          calls += 1;
          return batch("single", []);
        }),
      ],
      { randomUUID: ids() },
    );
    const controller = new AbortController();
    controller.abort();

    await expect(
      engine.search(
        { query: "must stay local" },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ code: "search_cancelled" });
    expect(calls).toBe(0);
  });

  test("rejects ill-formed UTF-16 before provider disclosure", async () => {
    let calls = 0;
    const engine = new SearchEngine(
      [
        provider("single", async () => {
          calls += 1;
          return batch("single", []);
        }),
      ],
      { randomUUID: ids() },
    );

    await expect(
      engine.search({ query: "broken \ud800 query" }),
    ).rejects.toMatchObject({
      code: "invalid_request",
      message: "Search query must contain valid Unicode scalar values.",
    });
    expect(calls).toBe(0);

    const response = await engine.search({ query: "constructive joy 🌱" });
    expect(response.query.text).toBe("constructive joy 🌱");
    expect(calls).toBe(1);
  });

  test("stops dispatching providers when cancellation arrives mid-dispatch", async () => {
    const calls: string[] = [];
    const controller = new AbortController();
    const engine = new SearchEngine(
      [
        provider("first", async () => {
          calls.push("first");
          controller.abort();
          return batch("first", []);
        }),
        provider("second", async () => {
          calls.push("second");
          return batch("second", []);
        }),
      ],
      { randomUUID: ids() },
    );

    const response = await engine.search(
      { query: "cancel while dispatching" },
      { signal: controller.signal },
    );

    expect(calls).toEqual(["first"]);
    expect(response.status).toBe("inconclusive");
    expect(response.privacy.query_sent_to).toEqual(["first"]);
    expect(response.diagnostics.map((item) => item.code)).toEqual([
      "provider_cancelled",
      "provider_cancelled",
    ]);
    expect(response.diagnostics.map((item) => item.message)).toEqual([
      "Provider search was cancelled after dispatch.",
      "Provider search was cancelled before dispatch.",
    ]);
  });

  test("rejects unknown providers and unsupported kinds before disclosure", async () => {
    let calls = 0;
    const engine = new SearchEngine(
      [
        provider(
          "agents",
          async () => {
            calls += 1;
            return batch("agents", []);
          },
          ["agent"],
        ),
      ],
      { randomUUID: ids() },
    );

    await expect(
      engine.search({ query: "x", provider_ids: ["missing"] }),
    ).rejects.toMatchObject({ code: "provider_not_found" });
    await expect(
      engine.search({ query: "x", kinds: ["documentation"] }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(calls).toBe(0);
  });

  test("allows safety limits to narrow but not exceed the static protocol", () => {
    const fixture = provider("single", async () => batch("single", []));

    expect(
      () =>
        new SearchEngine([fixture], {
          limits: { max_results: 26 },
        }),
    ).toThrow("exceeds the protocol maximum");
    expect(
      () =>
        new SearchEngine([fixture], {
          limits: { max_providers: 2, max_evidence: 1 },
        }),
    ).toThrow("Evidence capacity");
    expect(
      () =>
        new SearchEngine([fixture], {
          limits: {
            default_results: 5,
            max_results: 5,
            max_query_chars: 128,
          },
        }),
    ).not.toThrow();
  });

  test("allows one active aggregate search without queueing", async () => {
    let release: (() => void) | undefined;
    let markStarted: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const engine = new SearchEngine(
      [
        provider("single", async () => {
          markStarted?.();
          await gate;
          return batch("single", []);
        }),
      ],
      { randomUUID: ids() },
    );

    const first = engine.search({ query: "first" });
    await started;
    await expect(
      engine.search({ query: "second" }),
    ).rejects.toMatchObject({
      code: "search_unavailable",
      message: "Another agent search is already active.",
    });

    release?.();
    await first;
  });
});
