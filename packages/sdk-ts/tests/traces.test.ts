/** Trace client contract tests — live wire shape, compatibility, and lineage. */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { AgentTool, AgentToolError } from "../src/index.js";

const originalFetch = globalThis.fetch;
let calls: Array<{ url: string; init: RequestInit }> = [];
let responses: Response[] = [];

const RHETORLINT_SIGNAL = {
  schema: "rhetorlint.signal/0.1",
  kind: "rhetorlint.analysis",
  boundary: {
    observes: "visible-language-patterns",
    doesNot: [
      "infer-speaker-intent",
      "detect-deception",
      "determine-factual-truth",
    ],
    note:
      "RhetorLint marks visible language patterns. It does not infer speaker intent, detect deception, or determine whether a claim is factually true.",
  },
  rhetorlint: "0.1",
  engine: {
    name: "@rhetorlint/core",
    version: "0.1.1",
    rules: "@rhetorlint/rules-en@0.1.0",
  },
  source: { chars: 0, words: 0, locale: "en" },
  density: { tells: 0, per100Words: 0 },
  summary: { families: [], rules: [] },
};

const TRACE_PAYLOAD = {
  trace_id: "tr_abc123",
  id: "550e8400-e29b-41d4-a716-446655440000",
  agent_id: "test-agent",
  identity_id: "550e8400-e29b-41d4-a716-446655440001",
  session_id: null,
  parent_trace_id: null,
  decision_type: "decision",
  decision_summary: "User approaching limit",
  output_ref: null,
  conclusion: "Suggest upgrade",
  observations: ["obs1", "obs2"],
  hypothesis: null,
  confidence: 0.95,
  alternatives: null,
  signals: { source_count: 2 },
  files_read: null,
  key_facts: null,
  external_signals: { rhetorlint: RHETORLINT_SIGNAL },
  tags: ["billing"],
  metadata: { client_source: "sdk-ts" },
  signature: null,
  signing_key_id: null,
  has_signature: false,
  created_at: "2026-07-17T12:00:00Z",
};

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function enqueue(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  responses.push(jsonResponse(status, body, headers));
}

function bodyOf(index = 0): Record<string, unknown> {
  return JSON.parse(calls[index].init.body as string) as Record<string, unknown>;
}

beforeEach(() => {
  calls = [];
  responses = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    const response = responses.shift();
    if (!response) throw new Error(`No mock response queued for ${String(input)}`);
    return response;
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("TracesClient.store", () => {
  test("sends the live nested contract and a redacted RhetorLint signal", async () => {
    enqueue(201, { trace_id: TRACE_PAYLOAD.trace_id });
    enqueue(200, TRACE_PAYLOAD);

    const at = new AgentTool({ apiKey: "test-key" });
    const trace = await at.traces.store({
      observations: ["Reviewed response language"],
      conclusion: "Keep the report namespaced and explicit",
      decision_type: "decision",
      decision_summary: "Attach local language analysis",
      output_ref: "memory:review",
      agent_id: "test-agent",
      identity_id: "550e8400-e29b-41d4-a716-446655440001",
      session_id: "session-1",
      alternatives: [
        {
          option: "Upload automatically",
          why_not: "The report must remain explicit and opt-in",
        },
      ],
      signals: { source_count: 2 },
      tags: ["language-review"],
      files_read: ["draft.md"],
      key_facts: ["RhetorLint reads language, not people"],
      external_signals: { rhetorlint: RHETORLINT_SIGNAL },
      metadata: { review: "local-language-analysis" },
    });

    expect(calls[0].url).toEndWith("/v1/traces");
    expect(calls[1].url).toEndWith(`/v1/traces/${TRACE_PAYLOAD.trace_id}`);
    const body = bodyOf();
    expect(body.decision).toEqual({
      type: "decision",
      summary: "Attach local language analysis",
      output_ref: "memory:review",
    });
    expect(body.reasoning).toEqual({
      observations: ["Reviewed response language"],
      conclusion: "Keep the report namespaced and explicit",
      alternatives: [
        {
          option: "Upload automatically",
          why_not: "The report must remain explicit and opt-in",
        },
      ],
      signals: { source_count: 2 },
    });
    expect(body.context).toEqual({
      files_read: ["draft.md"],
      key_facts: ["RhetorLint reads language, not people"],
      external_signals: { rhetorlint: RHETORLINT_SIGNAL },
    });
    expect(body.identity_id).toBe("550e8400-e29b-41d4-a716-446655440001");
    expect(body.metadata).toEqual({ review: "local-language-analysis" });
    expect(body).not.toHaveProperty("observations");
    expect(body).not.toHaveProperty("conclusion");
    expect(body).not.toHaveProperty("key_facts");

    expect(trace.external_signals).toEqual({ rhetorlint: RHETORLINT_SIGNAL });
    expect(RHETORLINT_SIGNAL).not.toHaveProperty("marks");
    expect(RHETORLINT_SIGNAL).not.toHaveProperty("strip");
    expect(RHETORLINT_SIGNAL).not.toHaveProperty("rewrite");
    expect(trace.identity_id).toBe("550e8400-e29b-41d4-a716-446655440001");
  });

  test("omits context when no context fields were supplied", async () => {
    enqueue(201, { trace_id: TRACE_PAYLOAD.trace_id });
    enqueue(200, TRACE_PAYLOAD);

    const at = new AgentTool({ apiKey: "test-key" });
    await at.traces.store({ observations: [], conclusion: "Done" });

    expect(bodyOf()).not.toHaveProperty("context");
  });

  test("preserves legacy string alternatives without inventing why_not", async () => {
    enqueue(201, { trace_id: TRACE_PAYLOAD.trace_id });
    enqueue(200, TRACE_PAYLOAD);

    const at = new AgentTool({ apiKey: "test-key" });
    await at.traces.store({
      observations: [],
      conclusion: "Done",
      alternatives: ["Do nothing"],
    });

    expect(bodyOf().reasoning).toMatchObject({
      alternatives: [{ option: "Do nothing", why_not: "" }],
    });
  });

  test("prefers the live validation message when a trace request fails", async () => {
    enqueue(
      400,
      {
        error: "validation",
        message: "The trace needs a small adjustment.",
        details: { fieldErrors: { reasoning: ["Required"] } },
      },
      { "Retry-After": "9", "PAYMENT-REQUIRED": "test-challenge" },
    );

    const at = new AgentTool({ apiKey: "test-key" });
    await expect(
      at.traces.store({ observations: [], conclusion: "Done" }),
    ).rejects.toMatchObject({
      message: "The trace needs a small adjustment.",
      code: "validation",
      status: 400,
      retryAfter: "9",
      paymentRequired: "test-challenge",
    } satisfies Partial<AgentToolError>);
  });
});

describe("TracesClient response shapes", () => {
  test("unwraps live full-text results and omits unsupported tag", async () => {
    enqueue(200, { results: [{ ...TRACE_PAYLOAD, score: 0.8125 }], count: 1 });

    const at = new AgentTool({ apiKey: "test-key" });
    const results = await at.traces.search("upgrade", {
      identity_id: "550e8400-e29b-41d4-a716-446655440001",
      decision_type: "decision",
      tag: "legacy-ignored",
      limit: 3,
    });

    expect(results).toHaveLength(1);
    expect(results[0].score).toBe(0.8125);
    expect(results[0].trace.trace_id).toBe(TRACE_PAYLOAD.trace_id);
    expect(results[0].trace).not.toHaveProperty("score");
    expect(bodyOf()).toEqual({
      query: "upgrade",
      limit: 3,
      identity_id: "550e8400-e29b-41d4-a716-446655440001",
      decision_type: "decision",
    });
  });

  test("returns live lineage plus deprecated aliases", async () => {
    const ancestor = {
      ...TRACE_PAYLOAD,
      id: "550e8400-e29b-41d4-a716-446655440003",
      trace_id: "tr_a11ce1",
    };
    const descendant = {
      ...TRACE_PAYLOAD,
      id: "550e8400-e29b-41d4-a716-446655440004",
      trace_id: "tr_dec0de",
      parent_trace_id: TRACE_PAYLOAD.trace_id,
    };
    enqueue(200, {
      root: TRACE_PAYLOAD,
      ancestors: [ancestor],
      descendants: [descendant],
      counts: { ancestors: 1, descendants: 1 },
    });

    const at = new AgentTool({ apiKey: "test-key" });
    const chain = await at.traces.chain(TRACE_PAYLOAD.trace_id);

    expect(chain.root.trace_id).toBe(TRACE_PAYLOAD.trace_id);
    expect(chain.ancestors[0].trace_id).toBe("tr_a11ce1");
    expect(chain.descendants[0].trace_id).toBe("tr_dec0de");
    expect(chain.counts).toEqual({ ancestors: 1, descendants: 1 });
    expect(chain.parent).toBe(chain.root);
    expect(chain.children).toBe(chain.descendants);
    expect(chain.depth).toBe(1);
  });
});
