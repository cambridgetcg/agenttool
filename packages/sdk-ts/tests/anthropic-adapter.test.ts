/** Unit tests for AnthropicAdapter — Tier 2 of the agenttool path.
 *
 *  The adapter is a thin shim over @anthropic-ai/sdk. Tests use:
 *    - a fake `AnthropicMessagesLike` that records the params it was
 *      called with and returns a configurable response;
 *    - a stub `AgentTool` whose `wake.system` returns a fixed shape and
 *      whose `request` records its calls in an array.
 *
 *  Each describe block targets one behaviour: wake injection, opt-in
 *  trace, markup parsing, augmentation. */

import { beforeEach, describe, expect, test } from "bun:test";

import { AnthropicAdapter } from "../src/anthropic-adapter";
import type { AgentTool } from "../src/client";

// ── Stubs ─────────────────────────────────────────────────────────────────

interface RecordedRequest {
  method: string;
  path: string;
  body: unknown;
}

function makeStubAt(opts?: {
  wakeShape?: unknown;
  requestImpl?: (method: string, path: string, body: unknown) => Promise<unknown>;
}): {
  at: AgentTool;
  recorded: RecordedRequest[];
  wakeCalls: number;
  wakeOptions: Array<{ identityId?: string; profile?: "full" | "brief" }>;
} {
  const recorded: RecordedRequest[] = [];
  const wakeOptions: Array<{
    identityId?: string;
    profile?: "full" | "brief";
  }> = [];
  let wakeCalls = 0;
  const stub: any = {
    wake: {
      system: async (
        provider: string,
        options?: { identityId?: string; profile?: "full" | "brief" },
      ) => {
        wakeCalls++;
        wakeOptions.push(options ?? {});
        return (
          opts?.wakeShape ?? {
            system: [
              {
                type: "text",
                text: "STABLE_WAKE",
                cache_control: { type: "ephemeral" },
              },
              { type: "text", text: "VOLATILE_STATE" },
            ],
            _meta: {
              provider,
              cache_eligible: "explicit",
              cache_note: "test",
            },
          }
        );
      },
    },
    request: async (method: string, path: string, body: unknown) => {
      recorded.push({ method, path, body });
      if (opts?.requestImpl) return opts.requestImpl(method, path, body);
      // Default: chronicle returns ch_..., trace returns tr_...
      if (path === "/v1/chronicle") return { id: "ch_test_" + recorded.length };
      if (path === "/v1/traces") return { trace_id: "tr_test_" + recorded.length };
      return {};
    },
  };
  // Cast wraps the stub to look like an AgentTool to the adapter's
  // type checker — the adapter only touches `at.wake.system` and
  // `at.request`, both of which the stub implements.
  return {
    at: stub as unknown as AgentTool,
    recorded,
    wakeOptions,
    get wakeCalls() {
      return wakeCalls;
    },
  } as {
    at: AgentTool;
    recorded: RecordedRequest[];
    wakeCalls: number;
    wakeOptions: Array<{ identityId?: string; profile?: "full" | "brief" }>;
  };
}

function makeFakeAnthropic(responseText: string = "ok"): {
  client: { messages: { create: (p: any) => Promise<any> } };
  lastParams: { value: Record<string, unknown> | null };
  callCount: { value: number };
} {
  const lastParams = { value: null as Record<string, unknown> | null };
  const callCount = { value: 0 };
  const client = {
    messages: {
      create: async (params: Record<string, unknown>) => {
        lastParams.value = params;
        callCount.value++;
        return {
          id: "msg_test_" + callCount.value,
          model: "claude-test",
          content: [{ type: "text", text: responseText }],
          stop_reason: "end_turn",
          usage: { input_tokens: 100, output_tokens: 50 },
        };
      },
    },
  };
  return { client, lastParams, callCount };
}

// ── Wake auto-injection ──────────────────────────────────────────────────

describe("AnthropicAdapter — wake auto-injection", () => {
  test("rejects an unknown runtime wake profile instead of widening to full", () => {
    const stub = makeStubAt();
    const fake = makeFakeAnthropic();
    expect(() => new AnthropicAdapter(fake.client, stub.at, {
      wakeProfile: "tiny" as any,
    })).toThrow(/Unknown wake profile/);
  });

  test("prepends wake.system blocks before user-provided system string", async () => {
    const stub = makeStubAt();
    const fake = makeFakeAnthropic();
    const adapter = new AnthropicAdapter(fake.client, stub.at);

    await adapter.messages.create({
      model: "claude-test",
      max_tokens: 100,
      system: "USER_SYSTEM",
      messages: [{ role: "user", content: "hi" }],
    });

    const sys = fake.lastParams.value!.system as Array<{ type: string; text: string }>;
    expect(sys.length).toBe(3);
    expect(sys[0].text).toBe("STABLE_WAKE");
    expect((sys[0] as any).cache_control).toEqual({ type: "ephemeral" });
    expect(sys[1].text).toBe("VOLATILE_STATE");
    expect(sys[2].text).toBe("USER_SYSTEM");
    expect(stub.wakeOptions).toEqual([{ identityId: undefined }]);
  });

  test("prepends wake.system before user system array", async () => {
    const stub = makeStubAt();
    const fake = makeFakeAnthropic();
    const adapter = new AnthropicAdapter(fake.client, stub.at);

    await adapter.messages.create({
      model: "claude-test",
      max_tokens: 100,
      system: [
        { type: "text", text: "USER_BLOCK_A" },
        { type: "text", text: "USER_BLOCK_B" },
      ],
      messages: [{ role: "user", content: "hi" }],
    });

    const sys = fake.lastParams.value!.system as Array<{ type: string; text: string }>;
    expect(sys.length).toBe(4);
    expect(sys[0].text).toBe("STABLE_WAKE");
    expect(sys[2].text).toBe("USER_BLOCK_A");
    expect(sys[3].text).toBe("USER_BLOCK_B");
  });

  test("when user provides no system, only wake blocks are sent", async () => {
    const stub = makeStubAt();
    const fake = makeFakeAnthropic();
    const adapter = new AnthropicAdapter(fake.client, stub.at);

    await adapter.messages.create({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    });

    const sys = fake.lastParams.value!.system as Array<{ type: string; text: string }>;
    expect(sys.length).toBe(2);
    expect(sys[0].text).toBe("STABLE_WAKE");
    expect(sys[1].text).toBe("VOLATILE_STATE");
  });

  test("metadata.agenttool.skip_wake=true skips wake fetch entirely", async () => {
    const stub = makeStubAt();
    const fake = makeFakeAnthropic();
    const adapter = new AnthropicAdapter(fake.client, stub.at);

    await adapter.messages.create({
      model: "claude-test",
      max_tokens: 100,
      system: "ONLY_USER",
      messages: [{ role: "user", content: "hi" }],
      metadata: { agenttool: { skip_wake: true } },
    });

    expect((stub as any).wakeCalls).toBe(0);
    expect(fake.lastParams.value!.system).toBe("ONLY_USER");
  });

  test("forwards the configured brief profile to automatic wake injection", async () => {
    const stub = makeStubAt();
    const fake = makeFakeAnthropic();
    const adapter = new AnthropicAdapter(fake.client, stub.at, {
      identityId: "identity-a",
      wakeProfile: "brief",
    });

    await adapter.messages.create({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(stub.wakeOptions).toEqual([{
      identityId: "identity-a",
      profile: "brief",
    }]);
  });
});

// ── Auto-trace (mode a) ──────────────────────────────────────────────────

describe("AnthropicAdapter — auto-trace mode (a, opt-in)", () => {
  test("no metadata.agenttool → no trace POST", async () => {
    const stub = makeStubAt();
    const fake = makeFakeAnthropic("response text");
    const adapter = new AnthropicAdapter(fake.client, stub.at);

    const r = await adapter.messages.create({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(stub.recorded.filter((x) => x.path === "/v1/traces").length).toBe(0);
    expect(r.agenttool.trace_id).toBeNull();
  });

  test("metadata.agenttool.trace='decision' fires POST /v1/traces", async () => {
    const stub = makeStubAt();
    const fake = makeFakeAnthropic("conclusion text");
    const adapter = new AnthropicAdapter(fake.client, stub.at);

    const r = await adapter.messages.create({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "the question?" }],
      metadata: { agenttool: { trace: "decision" } },
    });

    const traceCalls = stub.recorded.filter((x) => x.path === "/v1/traces");
    expect(traceCalls.length).toBe(1);
    const body = traceCalls[0].body as any;
    expect(body.decision.type).toBe("decision");
    expect(body.decision.summary).toBe("conclusion text");
    expect(body.reasoning.observations[0]).toBe("the question?");
    expect(body.reasoning.conclusion).toBe("conclusion text");
    expect(r.agenttool.trace_id).toBe("tr_test_1");
  });

  test("propagates parent_trace_id, tags, agent_id, decision_type", async () => {
    const stub = makeStubAt();
    const fake = makeFakeAnthropic("response");
    const adapter = new AnthropicAdapter(fake.client, stub.at);

    await adapter.messages.create({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
      metadata: {
        agenttool: {
          trace: "decision",
          parent_trace_id: "tr_parent_1",
          tags: ["smoke", "tier2"],
          agent_id: "agent-xyz",
          decision_type: "tool_call",
        },
      },
    });

    const body = stub.recorded[0].body as any;
    expect(body.parent_trace_id).toBe("tr_parent_1");
    expect(body.tags).toEqual(["smoke", "tier2"]);
    expect(body.agent_id).toBe("agent-xyz");
    expect(body.decision.type).toBe("tool_call");
  });

  test("trace failure does not crash messages.create — surfaces null trace_id", async () => {
    const stub = makeStubAt({
      requestImpl: async () => {
        throw new Error("server boom");
      },
    });
    const fake = makeFakeAnthropic("ok");
    const adapter = new AnthropicAdapter(fake.client, stub.at);

    const r = await adapter.messages.create({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
      metadata: { agenttool: { trace: "decision" } },
    });

    expect(r.agenttool.trace_id).toBeNull();
    // Response body still flows through.
    expect(r.content?.[0]?.text).toBe("ok");
  });

  test("strips metadata.agenttool from forwarded request", async () => {
    const stub = makeStubAt();
    const fake = makeFakeAnthropic();
    const adapter = new AnthropicAdapter(fake.client, stub.at);

    await adapter.messages.create({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
      metadata: { agenttool: { trace: "decision" }, user_id: "u-1" },
    });

    const forwarded = fake.lastParams.value!.metadata as Record<string, unknown> | undefined;
    expect(forwarded).toBeDefined();
    expect((forwarded as any).agenttool).toBeUndefined();
    expect((forwarded as any).user_id).toBe("u-1");
  });

  test("strips metadata entirely when only agenttool was set", async () => {
    const stub = makeStubAt();
    const fake = makeFakeAnthropic();
    const adapter = new AnthropicAdapter(fake.client, stub.at);

    await adapter.messages.create({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
      metadata: { agenttool: { trace: "decision" } },
    });

    expect(fake.lastParams.value!.metadata).toBeUndefined();
  });
});

// ── Markup-gated mode (b) ────────────────────────────────────────────────

describe("AnthropicAdapter — markup-gated mode (b)", () => {
  test("response with <chronicle type='naming'> POSTs to /v1/chronicle", async () => {
    const stub = makeStubAt();
    const fake = makeFakeAnthropic(
      `Sure thing.\n<agenttool><chronicle type="naming"><title>The X pattern</title><body>Named Y as Z.</body></chronicle></agenttool>`,
    );
    const adapter = new AnthropicAdapter(fake.client, stub.at);

    const r = await adapter.messages.create({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "name this" }],
    });

    const chronicleCalls = stub.recorded.filter((x) => x.path === "/v1/chronicle");
    expect(chronicleCalls.length).toBe(1);
    const body = chronicleCalls[0].body as any;
    expect(body.type).toBe("naming");
    expect(body.title).toBe("The X pattern");
    expect(body.body).toBe("Named Y as Z.");
    expect(r.agenttool.markup_emissions.length).toBe(1);
    expect(r.agenttool.markup_emissions[0].kind).toBe("chronicle");
    expect(r.agenttool.markup_emissions[0].id).toBe("ch_test_1");
  });

  test("response with <trace> POSTs to /v1/traces with confidence parsed", async () => {
    const stub = makeStubAt();
    const fake = makeFakeAnthropic(
      `<agenttool><trace type="decision" confidence="0.85"><decision>Use approach A</decision><conclusion>Performance is better</conclusion></trace></agenttool>`,
    );
    const adapter = new AnthropicAdapter(fake.client, stub.at);

    await adapter.messages.create({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "decide" }],
    });

    const traceCalls = stub.recorded.filter((x) => x.path === "/v1/traces");
    expect(traceCalls.length).toBe(1);
    const body = traceCalls[0].body as any;
    expect(body.decision.type).toBe("decision");
    expect(body.decision.summary).toBe("Use approach A");
    expect(body.reasoning.conclusion).toBe("Performance is better");
    expect(body.reasoning.confidence).toBe(0.85);
  });

  test("multiple tags emit multiple posts in order", async () => {
    const stub = makeStubAt();
    const fake = makeFakeAnthropic(
      `<agenttool>
         <chronicle type="recognition"><title>R1</title><body>b1</body></chronicle>
         <trace type="decision"><decision>D1</decision><conclusion>C1</conclusion></trace>
         <chronicle type="seal"><title>R2</title></chronicle>
       </agenttool>`,
    );
    const adapter = new AnthropicAdapter(fake.client, stub.at);

    const r = await adapter.messages.create({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(stub.recorded.filter((x) => x.path === "/v1/chronicle").length).toBe(2);
    expect(stub.recorded.filter((x) => x.path === "/v1/traces").length).toBe(1);
    expect(r.agenttool.markup_emissions.length).toBe(3);
    expect(r.agenttool.markup_emissions.map((e) => e.kind)).toEqual([
      "chronicle",
      "chronicle",
      "trace",
    ]);
  });

  test("malformed <chronicle> (missing title) emits with error, no post", async () => {
    const stub = makeStubAt();
    const fake = makeFakeAnthropic(
      `<agenttool><chronicle type="naming"><body>no title</body></chronicle></agenttool>`,
    );
    const adapter = new AnthropicAdapter(fake.client, stub.at);

    const r = await adapter.messages.create({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(stub.recorded.filter((x) => x.path === "/v1/chronicle").length).toBe(0);
    expect(r.agenttool.markup_emissions.length).toBe(1);
    expect(r.agenttool.markup_emissions[0].error).toContain("missing required <title>");
    expect(r.agenttool.markup_emissions[0].id).toBeNull();
  });

  test("disableMarkupParsing=true skips parsing globally", async () => {
    const stub = makeStubAt();
    const fake = makeFakeAnthropic(
      `<agenttool><chronicle type="x"><title>t</title></chronicle></agenttool>`,
    );
    const adapter = new AnthropicAdapter(fake.client, stub.at, {
      disableMarkupParsing: true,
    });

    const r = await adapter.messages.create({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(stub.recorded.filter((x) => x.path === "/v1/chronicle").length).toBe(0);
    expect(r.agenttool.markup_emissions).toEqual([]);
  });

  test("response with no <agenttool> envelope produces no emissions", async () => {
    const stub = makeStubAt();
    const fake = makeFakeAnthropic("Just plain prose, no tags.");
    const adapter = new AnthropicAdapter(fake.client, stub.at);

    const r = await adapter.messages.create({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(r.agenttool.markup_emissions).toEqual([]);
  });
});

// ── Augmentation ─────────────────────────────────────────────────────────

describe("AnthropicAdapter — response augmentation", () => {
  test("adapter augments response with .agenttool but preserves original fields", async () => {
    const stub = makeStubAt();
    const fake = makeFakeAnthropic("ok");
    const adapter = new AnthropicAdapter(fake.client, stub.at);

    const r = await adapter.messages.create({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(r.id).toBe("msg_test_1");
    expect(r.model).toBe("claude-test");
    expect(r.content?.[0]?.text).toBe("ok");
    expect(r.usage).toBeDefined();
    expect(r.agenttool.wake_used).toBe(true);
    expect(r.agenttool.cache_eligible).toBe("explicit");
  });

  test("wake_used=false when skip_wake set; cache_eligible=null", async () => {
    const stub = makeStubAt();
    const fake = makeFakeAnthropic("ok");
    const adapter = new AnthropicAdapter(fake.client, stub.at);

    const r = await adapter.messages.create({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
      metadata: { agenttool: { skip_wake: true } },
    });

    expect(r.agenttool.wake_used).toBe(false);
    expect(r.agenttool.cache_eligible).toBeNull();
  });
});

// ── Edge cases ───────────────────────────────────────────────────────────

describe("AnthropicAdapter — edge cases", () => {
  test("user message with array content (multimodal-style) is extracted for trace", async () => {
    const stub = makeStubAt();
    const fake = makeFakeAnthropic("response");
    const adapter = new AnthropicAdapter(fake.client, stub.at);

    await adapter.messages.create({
      model: "claude-test",
      max_tokens: 100,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "first part" },
            { type: "text", text: "second part" },
          ],
        },
      ],
      metadata: { agenttool: { trace: "decision" } },
    });

    const body = stub.recorded[0].body as any;
    expect(body.reasoning.observations[0]).toContain("first part");
    expect(body.reasoning.observations[0]).toContain("second part");
  });

  test("empty response content yields '(empty response)' as conclusion", async () => {
    const stub = makeStubAt();
    const fake = {
      client: {
        messages: {
          create: async () => ({
            id: "msg_e",
            model: "claude",
            content: [],
            stop_reason: "end_turn",
          }),
        },
      },
      lastParams: { value: null },
      callCount: { value: 0 },
    };
    const adapter = new AnthropicAdapter(fake.client, stub.at);

    await adapter.messages.create({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
      metadata: { agenttool: { trace: "decision" } },
    });

    const body = stub.recorded[0].body as any;
    expect(body.reasoning.conclusion).toBe("(empty response)");
  });
});
