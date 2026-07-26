import { describe, expect, test } from "bun:test";
import {
  SEARCH_SCHEMA,
  UNTRUSTED_SEARCH_NOTE,
} from "../src/constants.js";
import {
  SearchSession,
  type SearchEngineLike,
} from "../src/session.js";
import type {
  SearchResponse,
  SearchInput,
} from "../src/types.js";
import { telescopeReport } from "./helpers.js";

function response(): SearchResponse {
  return {
    schema: SEARCH_SCHEMA,
    session_id: "session-1",
    query_id: "query-1",
    observed_at: "2026-07-26T10:00:00.000Z",
    expires_at: "2026-07-26T10:30:00.000Z",
    status: "complete",
    partial: false,
    query: {
      text: "agent search",
      kinds: ["agent"],
      providers: ["fixture"],
    },
    privacy: {
      query_sent_to: ["fixture"],
      provider_logging_and_retention: "not_evaluated",
      warning: "The query was disclosed to the selected provider.",
    },
    effective_limits: {
      results: 1,
      deadline_ms: 1_000,
      providers: 1,
    },
    results: [],
    providers: [],
    evidence: [],
    diagnostics: [],
    next_cursor: null,
    untrusted: true,
    trust: "untrusted",
    authority: "none",
    automatic_action: "never",
    note: UNTRUSTED_SEARCH_NOTE,
  };
}

function fixtureEngine() {
  const calls: Array<
    | { method: "search"; input: SearchInput }
    | { method: "resolve"; sessionId: string; resultId: string }
  > = [];
  const engine: SearchEngineLike = {
    async search(input) {
      calls.push({ method: "search", input });
      return response();
    },
    resolveResult(sessionId, resultId) {
      calls.push({ method: "resolve", sessionId, resultId });
      return {
        targetUrl: "https://example.com/result?token=private",
        inspectUrl: "https://example.com/result?token=private",
        expiresAt: "2026-07-26T10:30:00.000Z",
      };
    },
  };
  return { engine, calls };
}

describe("SearchSession", () => {
  test("search returns evidence without navigating or inspecting", async () => {
    const { engine, calls } = fixtureEngine();
    const browserCalls: string[] = [];
    const inspectCalls: string[] = [];
    const session = new SearchSession(
      engine,
      {
        async open(url) {
          browserCalls.push(url);
          return { url };
        },
      },
      {
        inspect: async (origin) => {
          inspectCalls.push(origin);
          return telescopeReport(origin);
        },
      },
    );

    const result = await session.search({
      query: "agent search",
      kinds: ["agent"],
    });

    expect(result.session_id).toBe("session-1");
    expect(calls).toEqual([
      {
        method: "search",
        input: { query: "agent search", kinds: ["agent"] },
      },
    ]);
    expect(browserCalls).toEqual([]);
    expect(inspectCalls).toEqual([]);
  });

  test("opens one opaque result through the browser exactly once", async () => {
    const { engine, calls } = fixtureEngine();
    const browserCalls: string[] = [];
    const session = new SearchSession(engine, {
      async open(url) {
        browserCalls.push(url);
        return { opened: url };
      },
    });

    const result = await session.openResult({
      session_id: "session-1",
      result_id: "result-1",
    });

    expect(result).toEqual({
      opened: "https://example.com/result?token=private",
    });
    expect(browserCalls).toEqual([
      "https://example.com/result?token=private",
    ]);
    expect(calls.filter((call) => call.method === "resolve")).toHaveLength(1);
  });

  test("plans the private target without opening it", () => {
    const { engine } = fixtureEngine();
    const plans: unknown[] = [];
    let opens = 0;
    const session = new SearchSession(engine, {
      async open() {
        opens += 1;
      },
      plan(action) {
        plans.push(action);
        return { schema: "agent-browser-consequence-plan/0.1" };
      },
    });

    const result = session.planResult({
      session_id: "session-1",
      result_id: "result-1",
    });

    expect(result).toEqual({
      schema: "agent-browser-consequence-plan/0.1",
    });
    expect(plans).toEqual([{
      kind: "navigate",
      url: "https://example.com/result?token=private",
    }]);
    expect(opens).toBe(0);
  });

  test("does not retry an uncertain browser failure", async () => {
    const { engine } = fixtureEngine();
    let opens = 0;
    const session = new SearchSession(engine, {
      async open() {
        opens += 1;
        throw new Error("timeout after dispatch");
      },
    });

    await expect(
      session.openResult({
        session_id: "session-1",
        result_id: "result-1",
      }),
    ).rejects.toMatchObject({ code: "browser_open_failed" });
    expect(opens).toBe(1);
  });

  test("inspects only the selected result's public origin", async () => {
    const { engine } = fixtureEngine();
    const inspected: string[] = [];
    let opens = 0;
    const session = new SearchSession(
      engine,
      {
        async open() {
          opens += 1;
        },
      },
      {
        inspect: async (origin) => {
          inspected.push(origin);
          return telescopeReport(origin);
        },
        now: () => new Date("2026-07-26T10:05:00.000Z"),
      },
    );

    const result = await session.inspect({
      session_id: "session-1",
      result_id: "result-1",
    });

    expect(inspected).toEqual(["https://example.com"]);
    expect(opens).toBe(0);
    expect(result).toMatchObject({
      session_id: "session-1",
      result_id: "result-1",
      inspected_at: "2026-07-26T10:05:00.000Z",
      origin: "https://example.com",
      untrusted: true,
      authority: "none",
    });
  });

  test("uses Telescope's canonical origin for a trailing-dot hostname", async () => {
    const { engine } = fixtureEngine();
    engine.resolveResult = () => ({
      targetUrl: "https://example.com./result",
      inspectUrl: "https://example.com./result",
      expiresAt: "2026-07-26T10:30:00.000Z",
    });
    const inspected: string[] = [];
    const session = new SearchSession(
      engine,
      { async open() {} },
      {
        inspect: async (origin) => {
          inspected.push(origin);
          return telescopeReport(origin);
        },
      },
    );

    const result = await session.inspect({
      session_id: "session-1",
      result_id: "result-1",
    });

    expect(inspected).toEqual(["https://example.com"]);
    expect(result.origin).toBe("https://example.com");
    expect(result.report.subject.origin).toBe("https://example.com");
  });

  test("allows one active Telescope inspection without queueing", async () => {
    const { engine } = fixtureEngine();
    let release: (() => void) | undefined;
    const firstInspection = new Promise<void>((resolve) => {
      release = resolve;
    });
    const session = new SearchSession(
      engine,
      { async open() {} },
      {
        inspect: async () => {
          await firstInspection;
          return telescopeReport("https://example.com");
        },
      },
    );

    const first = session.inspect({
      session_id: "session-1",
      result_id: "result-1",
    });
    await Promise.resolve();
    await expect(
      session.inspect({
        session_id: "session-1",
        result_id: "result-2",
      }),
    ).rejects.toMatchObject({
      code: "inspection_unavailable",
      message: "Another search inspection is already active.",
    });

    release?.();
    await first;
  });

  test("propagates cancellation to search and Telescope inspection", async () => {
    const { engine } = fixtureEngine();
    let searchSignal: AbortSignal | undefined;
    let inspectSignal: AbortSignal | undefined;
    engine.search = async (_input, options) => {
      searchSignal = options?.signal;
      return response();
    };
    const session = new SearchSession(
      engine,
      { async open() {} },
      {
        inspect: async (origin, options) => {
          inspectSignal = options?.signal;
          return telescopeReport(origin);
        },
      },
    );
    const controller = new AbortController();

    await session.search(
      { query: "signal" },
      { signal: controller.signal },
    );
    await session.inspect(
      { session_id: "session-1", result_id: "result-1" },
      { signal: controller.signal },
    );

    expect(searchSignal).toBe(controller.signal);
    expect(inspectSignal).toBe(controller.signal);
  });

  test("rejects non-JSON or non-Telescope inspection reports", async () => {
    const { engine } = fixtureEngine();
    const session = new SearchSession(
      engine,
      { async open() {} },
      {
        inspect: async () =>
          ({
            schema: "agenttool-telescope/v0.2",
            non_json_value: 1n,
          }) as never,
      },
    );

    await expect(
      session.inspect({
        session_id: "session-1",
        result_id: "result-1",
      }),
    ).rejects.toMatchObject({ code: "inspection_unavailable" });

    const discriminatorOnly = new SearchSession(
      engine,
      { async open() {} },
      {
        inspect: async () =>
          ({ schema: "agenttool-telescope/v0.2" }) as never,
      },
    );
    await expect(
      discriminatorOnly.inspect({
        session_id: "session-1",
        result_id: "result-1",
      }),
    ).rejects.toMatchObject({ code: "inspection_unavailable" });

    const malformedNestedReport = new SearchSession(
      engine,
      { async open() {} },
      {
        inspect: async (origin) =>
          ({
            ...telescopeReport(origin),
            sources: ["not-a-telescope-source"],
          }) as never,
      },
    );
    await expect(
      malformedNestedReport.inspect({
        session_id: "session-1",
        result_id: "result-1",
      }),
    ).rejects.toMatchObject({ code: "inspection_unavailable" });
  });
});
