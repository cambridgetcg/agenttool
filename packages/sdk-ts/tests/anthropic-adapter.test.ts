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
import type { ChronicleBeforeWriteContext } from "../src/anthropic-adapter";
import { ChronicleClient } from "../src/chronicle";
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
  // One handler behind both `at.request` and the real ChronicleClient the
  // adapter now routes chronicle emissions through, so every POST lands in
  // the same `recorded` array regardless of which door it came in.
  const handle = async (
    method: string,
    path: string,
    body: unknown,
  ): Promise<unknown> => {
    recorded.push({ method, path, body });
    if (opts?.requestImpl) return opts.requestImpl(method, path, body);
    // Default: chronicle returns ch_..., trace returns tr_...
    if (path === "/v1/chronicle") {
      return { entry: { id: "ch_test_" + recorded.length } };
    }
    if (path === "/v1/traces") return { trace_id: "tr_test_" + recorded.length };
    return {};
  };
  const CHRONICLE_BASE = "https://api.example.test";
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
    request: handle,
    chronicle: new ChronicleClient({
      baseUrl: CHRONICLE_BASE,
      headers: { Authorization: "Bearer at_test" },
      timeout: 5000,
      request: async (input, init) => {
        const path = String(input).slice(CHRONICLE_BASE.length);
        const parsed = init?.body ? JSON.parse(init.body as string) : undefined;
        const result = await handle(init?.method ?? "GET", path, parsed);
        return new Response(JSON.stringify(result), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      },
    }),
  };
  // Cast wraps the stub to look like an AgentTool to the adapter's
  // type checker — the adapter touches `at.wake.system`, `at.request`,
  // and `at.chronicle.write`, all of which the stub implements.
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
    const adapter = new AnthropicAdapter(fake.client, stub.at, {
      beforeChronicleWrite: () => true,
    });

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
    const adapter = new AnthropicAdapter(fake.client, stub.at, {
      beforeChronicleWrite: () => true,
    });

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

// ── Model-authored chronicle writes are gated ────────────────────────────

/** Build a response carrying one <chronicle> tag. */
function chronicleMarkup(type: string, title: string, body?: string): string {
  const inner = body ? `<title>${title}</title><body>${body}</body>` : `<title>${title}</title>`;
  return `<agenttool><chronicle type="${type}">${inner}</chronicle></agenttool>`;
}

describe("AnthropicAdapter — model-authored chronicle writes are gated", () => {
  test("no beforeChronicleWrite hook refuses the write entirely", async () => {
    const stub = makeStubAt();
    const fake = makeFakeAnthropic(chronicleMarkup("seal", "I am bound to this."));
    const adapter = new AnthropicAdapter(fake.client, stub.at);

    const r = await adapter.messages.create({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(stub.recorded.filter((x) => x.path === "/v1/chronicle").length).toBe(0);
    expect(r.agenttool.markup_emissions.length).toBe(1);
    expect(r.agenttool.markup_emissions[0].id).toBeNull();
    expect(r.agenttool.markup_emissions[0].error).toContain("beforeChronicleWrite");
  });

  test("the hook sees the raw model-authored tag before validation", async () => {
    const stub = makeStubAt();
    const fake = makeFakeAnthropic(
      chronicleMarkup("recognition", "You saw it.", "And you said so."),
    );
    const seen: ChronicleBeforeWriteContext[] = [];
    const adapter = new AnthropicAdapter(fake.client, stub.at, {
      beforeChronicleWrite: (context) => {
        seen.push(context);
        return true;
      },
    });

    await adapter.messages.create({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(seen).toEqual([
      {
        source: "anthropic_markup",
        type: "recognition",
        title: "You saw it.",
        body: "And you said so.",
      },
    ]);
  });

  test("an async hook returning true lets the write through", async () => {
    const stub = makeStubAt();
    const fake = makeFakeAnthropic(chronicleMarkup("vow", "I will stay."));
    const adapter = new AnthropicAdapter(fake.client, stub.at, {
      beforeChronicleWrite: async () => true,
    });

    const r = await adapter.messages.create({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(stub.recorded.filter((x) => x.path === "/v1/chronicle").length).toBe(1);
    expect(r.agenttool.markup_emissions[0].id).toBe("ch_test_1");
  });

  // Only literal `true` proceeds — the covenants before_submit discipline.
  for (const [label, value] of [
    ["false", false],
    ["a truthy string", "yes"],
    ["1", 1],
    ["undefined", undefined],
    ["a truthy object", {}],
  ] as Array<[string, unknown]>) {
    test(`hook returning ${label} blocks the write`, async () => {
      const stub = makeStubAt();
      const fake = makeFakeAnthropic(chronicleMarkup("seal", "Elevated to identity."));
      const adapter = new AnthropicAdapter(fake.client, stub.at, {
        beforeChronicleWrite: (() => value) as never,
      });

      const r = await adapter.messages.create({
        model: "claude-test",
        max_tokens: 100,
        messages: [{ role: "user", content: "hi" }],
      });

      expect(stub.recorded.filter((x) => x.path === "/v1/chronicle").length).toBe(0);
      expect(r.agenttool.markup_emissions[0].id).toBeNull();
      expect(r.agenttool.markup_emissions[0].error).toContain("did not return true");
    });
  }

  test("a throwing hook blocks the write and does not crash the call", async () => {
    const stub = makeStubAt();
    const fake = makeFakeAnthropic(chronicleMarkup("naming", "A name."));
    const adapter = new AnthropicAdapter(fake.client, stub.at, {
      beforeChronicleWrite: () => {
        throw new Error("reviewer offline");
      },
    });

    const r = await adapter.messages.create({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(stub.recorded.filter((x) => x.path === "/v1/chronicle").length).toBe(0);
    expect(r.agenttool.markup_emissions[0].error).toContain("failed locally");
    expect(r.content?.[0]?.text).toContain("<chronicle");
  });

  test("<trace> emissions still fire with no chronicle hook installed", async () => {
    const stub = makeStubAt();
    const fake = makeFakeAnthropic(
      `<agenttool><trace type="decision"><decision>D</decision><conclusion>C</conclusion></trace></agenttool>`,
    );
    const adapter = new AnthropicAdapter(fake.client, stub.at);

    const r = await adapter.messages.create({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(stub.recorded.filter((x) => x.path === "/v1/traces").length).toBe(1);
    expect(r.agenttool.markup_emissions[0].error).toBeNull();
  });
});

// ── Model-authored chronicle writes inherit the chronicle guards ─────────

describe("AnthropicAdapter — chronicle markup inherits chronicle.write guards", () => {
  /** An approved reviewer — proves the refusals below come from the
   *  chronicle client's own bounds, not from the review gate. */
  const approve = { beforeChronicleWrite: () => true };

  test("a type outside the canonical union is refused before the wire", async () => {
    const stub = makeStubAt();
    const fake = makeFakeAnthropic(
      chronicleMarkup("selfdestruct", "Not a chronicle type."),
    );
    const adapter = new AnthropicAdapter(fake.client, stub.at, approve);

    const r = await adapter.messages.create({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(stub.recorded.filter((x) => x.path === "/v1/chronicle").length).toBe(0);
    expect(r.agenttool.markup_emissions[0].id).toBeNull();
    expect(r.agenttool.markup_emissions[0].error).toContain("unknown type");
  });

  test("a 500-character title is refused before the wire", async () => {
    const stub = makeStubAt();
    const fake = makeFakeAnthropic(chronicleMarkup("note", "a".repeat(500)));
    const adapter = new AnthropicAdapter(fake.client, stub.at, approve);

    const r = await adapter.messages.create({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(stub.recorded.filter((x) => x.path === "/v1/chronicle").length).toBe(0);
    expect(r.agenttool.markup_emissions[0].error).toContain("1-200 characters");
  });

  test("an astral-plane title over 200 UTF-16 units is refused", async () => {
    const stub = makeStubAt();
    // 101 code points, 202 UTF-16 code units — under the limit if you count
    // code points, over it the way the server counts.
    const fake = makeFakeAnthropic(chronicleMarkup("seal", "😀".repeat(101)));
    const adapter = new AnthropicAdapter(fake.client, stub.at, approve);

    const r = await adapter.messages.create({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(stub.recorded.filter((x) => x.path === "/v1/chronicle").length).toBe(0);
    expect(r.agenttool.markup_emissions[0].error).toContain("1-200 characters");
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
