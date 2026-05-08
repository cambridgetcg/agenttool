/**
 * Unit tests for `at.deciding(...)` — Tier 3 sugar.
 *
 * The wrapper opens a parent trace from a framing string, runs a
 * function inside ambient context, and lets the AnthropicAdapter
 * chain child traces automatically. Mirrors the Python
 * test_deciding.py — each scenario in lockstep.
 *
 * Strategy: subclass AgentTool with a request() override that records
 * calls instead of hitting the network. The wake property is
 * preset to a stub so the adapter's auto-injection doesn't need a
 * live /v1/wake. The deciding() method itself is the real
 * production code path.
 */

import { describe, expect, test } from "bun:test";

import { AgentTool } from "../src/client";
import { getAmbient } from "../src/_context";
import { AnthropicAdapter } from "../src/anthropic-adapter";

// ── Stubs ────────────────────────────────────────────────────────────────

class StubAt extends AgentTool {
  recorded: Array<{ method: string; path: string; body: unknown }> = [];
  parentTraceId: string;

  constructor(parentTraceId = "tr_parent_1") {
    super({ apiKey: "test-key", baseUrl: "https://test.invalid" });
    this.parentTraceId = parentTraceId;
    // Pre-seed the lazy wake getter with a stub so the adapter's
    // auto-injection doesn't try to fetch over the network.
    (this as unknown as { _wake: unknown })._wake = stubWakeClient();
  }

  // Override the production fetcher to record the calls. Matches the
  // request signature on AgentTool.
  override async request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    this.recorded.push({ method, path, body });
    if (path === "/v1/traces") {
      const n = this.recorded.filter((c) => c.path === "/v1/traces").length;
      if (n === 1) return { trace_id: this.parentTraceId };
      return { trace_id: `tr_child_${n - 1}` };
    }
    if (path === "/v1/chronicle") {
      return { entry: { id: `ch_test_${this.recorded.length}` } };
    }
    return {};
  }
}

function stubWakeClient() {
  return {
    system: async (provider: string) => ({
      system: [
        {
          type: "text",
          text: "STABLE",
          cache_control: { type: "ephemeral" },
        },
        { type: "text", text: "VOLATILE" },
      ],
      _meta: {
        provider,
        cache_eligible: "explicit",
        cache_note: "test",
      },
    }),
  };
}

function fakeAnthropic(responseText: string = "ok") {
  let lastParams: Record<string, unknown> | null = null;
  let callCount = 0;
  return {
    get lastParams() {
      return lastParams;
    },
    get callCount() {
      return callCount;
    },
    client: {
      messages: {
        create: async (params: Record<string, unknown>) => {
          lastParams = params;
          callCount++;
          return {
            id: `msg_${callCount}`,
            model: "claude-test",
            content: [{ type: "text", text: responseText }],
            stop_reason: "end_turn",
          };
        },
      },
    },
  };
}

// ── Core behaviour ───────────────────────────────────────────────────────

describe("at.deciding(...) — opens parent trace from framing", () => {
  test("parent trace POST is made with framing as decision.summary", async () => {
    const at = new StubAt();
    let ambientInside: any = null;
    await at.deciding("whether to refactor auth", async () => {
      ambientInside = getAmbient();
    });

    // Ambient was visible inside; reset after.
    expect(ambientInside).toBeDefined();
    expect(ambientInside.parent_trace_id).toBe("tr_parent_1");
    expect(getAmbient()).toBeUndefined();

    // The parent trace was POSTed with framing as summary.
    expect(at.recorded.length).toBe(1);
    const { method, path, body } = at.recorded[0];
    expect(method).toBe("POST");
    expect(path).toBe("/v1/traces");
    expect((body as any).decision.type).toBe("deciding");
    expect((body as any).decision.summary).toBe("whether to refactor auth");
    expect((body as any).reasoning.conclusion).toBe(
      "whether to refactor auth",
    );
  });

  test("tags propagate to parent and merge with ambient", async () => {
    const at = new StubAt();
    let ambientInside: any = null;
    await at.deciding("decision A", { tags: ["a", "b"] }, async () => {
      ambientInside = getAmbient();
    });

    expect(ambientInside.tags).toEqual(["a", "b"]);
    expect((at.recorded[0].body as any).tags).toEqual(["a", "b"]);
  });

  test("decision_type override lands on parent body", async () => {
    const at = new StubAt();
    await at.deciding(
      "frame",
      { decision_type: "tool_call" },
      async () => {},
    );
    expect((at.recorded[0].body as any).decision.type).toBe("tool_call");
  });
});

describe("at.deciding(...) — calls inside auto-trace without opt-in", () => {
  test("messages.create inside fires auto-trace; chains parent", async () => {
    const at = new StubAt();
    const fake = fakeAnthropic("model response");
    const adapter = new AnthropicAdapter(fake.client, at);

    let resp: any = null;
    await at.deciding("frame X", async () => {
      resp = await adapter.messages.create({
        model: "claude-test",
        max_tokens: 100,
        messages: [{ role: "user", content: "go" }],
        // Notice: NO metadata.agenttool — usually would skip trace.
      });
    });

    const traceCalls = at.recorded.filter((c) => c.path === "/v1/traces");
    expect(traceCalls.length).toBe(2); // parent + child
    expect((traceCalls[1].body as any).parent_trace_id).toBe("tr_parent_1");
    expect(resp.agenttool.trace_id).toBe("tr_child_1");
  });

  test("explicit metadata.agenttool.parent_trace_id overrides ambient", async () => {
    const at = new StubAt();
    const fake = fakeAnthropic();
    const adapter = new AnthropicAdapter(fake.client, at);

    await at.deciding("frame", async () => {
      await adapter.messages.create({
        model: "claude-test",
        max_tokens: 100,
        messages: [{ role: "user", content: "go" }],
        metadata: {
          agenttool: {
            trace: "decision",
            parent_trace_id: "tr_explicit_other",
          },
        },
      });
    });

    const traceCalls = at.recorded.filter((c) => c.path === "/v1/traces");
    expect((traceCalls[1].body as any).parent_trace_id).toBe(
      "tr_explicit_other",
    );
  });

  test("ambient tags merge with explicit tags (explicit first)", async () => {
    const at = new StubAt();
    const fake = fakeAnthropic();
    const adapter = new AnthropicAdapter(fake.client, at);

    await at.deciding(
      "frame",
      { tags: ["ambient-a", "ambient-b"] },
      async () => {
        await adapter.messages.create({
          model: "claude-test",
          max_tokens: 100,
          messages: [{ role: "user", content: "go" }],
          metadata: {
            agenttool: { trace: "decision", tags: ["explicit"] },
          },
        });
      },
    );

    const traceCalls = at.recorded.filter((c) => c.path === "/v1/traces");
    expect((traceCalls[1].body as any).tags).toEqual([
      "explicit",
      "ambient-a",
      "ambient-b",
    ]);
  });

  test("outside deciding(): mode (a) opt-in still controls auto-trace", async () => {
    const at = new StubAt();
    const fake = fakeAnthropic();
    const adapter = new AnthropicAdapter(fake.client, at);

    const r = await adapter.messages.create({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "go" }],
    });

    expect(at.recorded.filter((c) => c.path === "/v1/traces").length).toBe(0);
    expect(r.agenttool.trace_id).toBeNull();
  });
});

describe("at.deciding(...) — nesting", () => {
  test("nested deciding() chains inner parent to outer parent", async () => {
    const at = new StubAt();
    let outerAmbient: any = null;
    let innerAmbient: any = null;
    await at.deciding("outer", { tags: ["outer-tag"] }, async () => {
      outerAmbient = getAmbient();
      await at.deciding(
        "inner",
        { tags: ["inner-tag"] },
        async () => {
          innerAmbient = getAmbient();
        },
      );
      // Inner exited; outer ambient restored.
      expect(getAmbient()?.parent_trace_id).toBe(outerAmbient.parent_trace_id);
    });

    expect(outerAmbient.parent_trace_id).toBe("tr_parent_1");
    // Inner ambient holds the inner parent (tr_child_1, since the second
    // /v1/traces POST returns that), not the outer's.
    expect(innerAmbient.parent_trace_id).toBe("tr_child_1");
    expect(innerAmbient.tags).toEqual(["outer-tag", "inner-tag"]);

    const posts = at.recorded.filter((c) => c.path === "/v1/traces");
    expect(posts.length).toBe(2);
    // The inner deciding's parent trace itself should chain to the outer.
    expect((posts[1].body as any).parent_trace_id).toBe("tr_parent_1");
    expect((posts[1].body as any).tags).toEqual(["outer-tag", "inner-tag"]);
  });

  test("call inside the inner block parents to inner trace", async () => {
    const at = new StubAt();
    const fake = fakeAnthropic();
    const adapter = new AnthropicAdapter(fake.client, at);

    await at.deciding("outer", async () => {
      await at.deciding("inner", async () => {
        await adapter.messages.create({
          model: "claude-test",
          max_tokens: 100,
          messages: [{ role: "user", content: "go" }],
        });
      });
    });

    const traceCalls = at.recorded.filter((c) => c.path === "/v1/traces");
    expect(traceCalls.length).toBe(3); // outer + inner + child
    // Child of the call should chain to the inner parent (tr_child_1
    // returned by the second POST — the inner deciding's own parent).
    expect((traceCalls[2].body as any).parent_trace_id).toBe("tr_child_1");
  });
});

describe("at.deciding(...) — failure modes", () => {
  test("parent trace POST failure does not crash the block", async () => {
    class BoomAt extends StubAt {
      override async request(
        method: string,
        path: string,
        body?: unknown,
      ): Promise<unknown> {
        this.recorded.push({ method, path, body });
        if (path === "/v1/traces" && this.recorded.length === 1) {
          throw new Error("server boom");
        }
        return {};
      }
    }
    const at = new BoomAt();
    let ambientInside: any = "unset";
    await at.deciding("frame", async () => {
      ambientInside = getAmbient();
    });

    expect(ambientInside).toBeDefined();
    expect(ambientInside.parent_trace_id).toBeNull();
  });

  test("ambient leaks neither before nor after the block", async () => {
    const at = new StubAt();
    expect(getAmbient()).toBeUndefined();
    await at.deciding("frame", async () => {
      expect(getAmbient()).toBeDefined();
    });
    expect(getAmbient()).toBeUndefined();
  });

  test("calling without an inner function throws AgentToolError", async () => {
    const at = new StubAt();
    await expect(
      // @ts-expect-error — testing the runtime guard
      at.deciding("frame"),
    ).rejects.toThrow(/needs an async function/);
  });
});

describe("at.deciding(...) — markup-emitted traces inherit ambient", () => {
  test("<trace> tag inside deciding() chains to ambient parent", async () => {
    const at = new StubAt();
    const fake = fakeAnthropic(
      `<agenttool><trace type="decision"><decision>Use approach Q</decision><conclusion>It is faster</conclusion></trace></agenttool>`,
    );
    const adapter = new AnthropicAdapter(fake.client, at);

    await at.deciding("frame", { tags: ["framing"] }, async () => {
      await adapter.messages.create({
        model: "claude-test",
        max_tokens: 100,
        messages: [{ role: "user", content: "go" }],
      });
    });

    // parent + auto-trace child + markup-emitted trace = 3 POSTs.
    const traceCalls = at.recorded.filter((c) => c.path === "/v1/traces");
    expect(traceCalls.length).toBe(3);
    // The markup-emitted trace (3rd) should chain to ambient parent.
    const markupBody = traceCalls[2].body as any;
    expect(markupBody.parent_trace_id).toBe("tr_parent_1");
    expect(markupBody.tags).toEqual(["framing"]);
  });
});
