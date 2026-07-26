import { describe, expect, test } from "bun:test";

import { ambientStorage } from "../src/_context";
import type { AgentTool } from "../src/client";
import {
  OpenAIResponsesAdapter,
  type OpenAIResponse,
} from "../src/openai-responses-adapter";

interface RecordedRequest {
  method: string;
  path: string;
  body: unknown;
}

function makeStubAt(opts?: {
  requestImpl?: (
    method: string,
    path: string,
    body: unknown,
  ) => Promise<unknown>;
}) {
  const state = {
    wakeCalls: 0,
    wakeOptions: [] as Array<{
      identityId?: string;
      profile?: "full" | "brief";
    }>,
    requests: [] as RecordedRequest[],
  };
  const at = {
    wake: {
      system: async (
        provider: string,
        options?: { identityId?: string; profile?: "full" | "brief" },
      ) => {
        state.wakeCalls++;
        state.wakeOptions.push(options ?? {});
        return {
          messages: [
            { role: "system", content: "STABLE_WAKE" },
            { role: "system", content: "VOLATILE_WAKE" },
          ],
          _meta: {
            provider,
            cache_eligible: "auto",
            cache_note: "test",
          },
        };
      },
    },
    request: async (method: string, path: string, body: unknown) => {
      state.requests.push({ method, path, body });
      if (opts?.requestImpl) return opts.requestImpl(method, path, body);
      return path === "/v1/traces" ? { trace_id: "tr_openai_test" } : {};
    },
  };
  return { at: at as unknown as AgentTool, state };
}

function makeFakeOpenAI(
  response: OpenAIResponse = {
    id: "resp_test",
    model: "gpt-test",
    output_text: "provider answer",
    output: [],
    usage: { input_tokens: 10, output_tokens: 4 },
  },
) {
  const state = {
    calls: 0,
    lastParams: null as Record<string, unknown> | null,
    lastOptions: undefined as unknown,
  };
  const client = {
    responses: {
      create: async (params: Record<string, unknown>, options?: unknown) => {
        state.calls++;
        state.lastParams = params;
        state.lastOptions = options;
        return response;
      },
    },
  };
  return { client, state };
}

describe("OpenAIResponsesAdapter — wake instructions", () => {
  test("rejects an unknown wake profile", () => {
    const stub = makeStubAt();
    const fake = makeFakeOpenAI();
    expect(() => new OpenAIResponsesAdapter(fake.client, stub.at, {
      wakeProfile: "tiny" as never,
    })).toThrow(/Unknown wake profile/);
  });

  test("rejects a client without responses.create", () => {
    const stub = makeStubAt();
    expect(() => new OpenAIResponsesAdapter(
      {} as never,
      stub.at,
    )).toThrow(/requires responses\.create/);
  });

  test("prepends wake before caller instructions and preserves request fields", async () => {
    const stub = makeStubAt();
    const fake = makeFakeOpenAI();
    const adapter = new OpenAIResponsesAdapter(fake.client, stub.at);

    await adapter.responses.create(
      {
        model: "gpt-test",
        instructions: "CALLER_INSTRUCTIONS",
        input: "hello",
        previous_response_id: "resp_previous",
        tools: [{ type: "function", name: "look" }],
      },
      { timeout: 12_000 },
    );

    expect(fake.state.lastParams?.instructions).toBe(
      "STABLE_WAKE\n\nVOLATILE_WAKE\n\nCALLER_INSTRUCTIONS",
    );
    expect(fake.state.lastParams?.previous_response_id).toBe("resp_previous");
    expect(fake.state.lastParams?.tools).toEqual([
      { type: "function", name: "look" },
    ]);
    expect(fake.state.lastOptions).toEqual({ timeout: 12_000 });
  });

  test("uses wake alone when caller instructions are absent", async () => {
    const stub = makeStubAt();
    const fake = makeFakeOpenAI();
    const adapter = new OpenAIResponsesAdapter(fake.client, stub.at);

    await adapter.responses.create({ model: "gpt-test", input: "hello" });

    expect(fake.state.lastParams?.instructions).toBe(
      "STABLE_WAKE\n\nVOLATILE_WAKE",
    );
    expect(fake.state.lastParams?.store).toBe(false);
  });

  test("preserves an explicit provider storage choice", async () => {
    const stub = makeStubAt();
    const fake = makeFakeOpenAI();
    const adapter = new OpenAIResponsesAdapter(fake.client, stub.at);

    await adapter.responses.create({
      model: "gpt-test",
      input: "hello",
      store: true,
    });

    expect(fake.state.lastParams?.store).toBe(true);
  });

  test("skip_wake preserves caller instructions and avoids wake I/O", async () => {
    const stub = makeStubAt();
    const fake = makeFakeOpenAI();
    const adapter = new OpenAIResponsesAdapter(fake.client, stub.at);

    const response = await adapter.responses.create({
      model: "gpt-test",
      instructions: "CALLER_ONLY",
      input: "hello",
      metadata: { agenttool: { skip_wake: true } },
    });

    expect(stub.state.wakeCalls).toBe(0);
    expect(fake.state.lastParams?.instructions).toBe("CALLER_ONLY");
    expect(response.agenttool.wake_used).toBe(false);
    expect(response.agenttool.cache_eligible).toBeNull();
  });

  test("forwards the explicit brief wake profile", async () => {
    const stub = makeStubAt();
    const fake = makeFakeOpenAI();
    const adapter = new OpenAIResponsesAdapter(fake.client, stub.at, {
      identityId: "identity-a",
      wakeProfile: "brief",
    });

    await adapter.responses.create({ model: "gpt-test", input: "hello" });

    expect(stub.state.wakeOptions).toEqual([{
      identityId: "identity-a",
      profile: "brief",
    }]);
  });

  test("rejects a non-string instructions value before the provider call", async () => {
    const stub = makeStubAt();
    const fake = makeFakeOpenAI();
    const adapter = new OpenAIResponsesAdapter(fake.client, stub.at);

    await expect(adapter.responses.create({
      model: "gpt-test",
      input: "hello",
      instructions: [{ type: "text", text: "not valid here" }],
    })).rejects.toThrow(/instructions must be a string/);
    expect(stub.state.wakeCalls).toBe(0);
    expect(fake.state.calls).toBe(0);
  });
});

describe("OpenAIResponsesAdapter — local controls and streaming boundary", () => {
  test("strips metadata.agenttool and preserves ordinary metadata", async () => {
    const stub = makeStubAt();
    const fake = makeFakeOpenAI();
    const adapter = new OpenAIResponsesAdapter(fake.client, stub.at);

    await adapter.responses.create({
      model: "gpt-test",
      input: "hello",
      metadata: {
        agenttool: { trace: false },
        tenant: "public-demo",
      },
    });

    expect(fake.state.lastParams?.metadata).toEqual({ tenant: "public-demo" });
  });

  test("removes metadata when it only contains adapter controls", async () => {
    const stub = makeStubAt();
    const fake = makeFakeOpenAI();
    const adapter = new OpenAIResponsesAdapter(fake.client, stub.at);

    await adapter.responses.create({
      model: "gpt-test",
      input: "hello",
      metadata: { agenttool: { trace: false } },
    });

    expect(fake.state.lastParams?.metadata).toBeUndefined();
  });

  test("rejects malformed adapter metadata before provider I/O", async () => {
    for (const badValue of ["decision", null, [], 42]) {
      const stub = makeStubAt();
      const fake = makeFakeOpenAI();
      const adapter = new OpenAIResponsesAdapter(fake.client, stub.at);

      await expect(adapter.responses.create({
        model: "gpt-test",
        input: "hello",
        metadata: { agenttool: badValue },
      })).rejects.toThrow(/metadata.agenttool must be an object/);
      expect(stub.state.wakeCalls).toBe(0);
      expect(fake.state.calls).toBe(0);
    }
  });

  test("validates every adapter control before provider I/O", async () => {
    const invalidControls = [
      { trace: true },
      { skip_wake: "false" },
      { parent_trace_id: 42 },
      { decision_type: false },
      { agent_id: [] },
      { trace: "decision", tags: 42 },
      { tags: ["valid", 7] },
      { parent_trace_id: "" },
      { parent_trace_id: "trace_parent" },
      { decision_type: "" },
      { decision_type: "x".repeat(65) },
      { decision_type: "😀".repeat(33) },
      { agent_id: "x".repeat(256) },
      { agent_id: "😀".repeat(128) },
      { tags: Array.from({ length: 33 }, () => "tag") },
      { tags: ["x".repeat(65)] },
    ];

    for (const controls of invalidControls) {
      const stub = makeStubAt();
      const fake = makeFakeOpenAI();
      const adapter = new OpenAIResponsesAdapter(fake.client, stub.at);

      await expect(adapter.responses.create({
        model: "gpt-test",
        input: "hello",
        metadata: { agenttool: controls },
      })).rejects.toThrow(/metadata\.agenttool\..* is invalid/);
      expect(stub.state.wakeCalls).toBe(0);
      expect(fake.state.calls).toBe(0);
    }
  });

  test("validates merged ambient and explicit tags before provider I/O", async () => {
    const stub = makeStubAt();
    const fake = makeFakeOpenAI();
    const adapter = new OpenAIResponsesAdapter(fake.client, stub.at);
    const ambientTags = Array.from({ length: 32 }, (_, index) => `ambient-${index}`);

    await expect(ambientStorage.run(
      { parent_trace_id: "tr_a11b1e", tags: ambientTags },
      () => adapter.responses.create({
        model: "gpt-test",
        input: "hello",
        metadata: { agenttool: { tags: ["explicit"] } },
      }),
    )).rejects.toThrow(/too many tags/);
    expect(stub.state.wakeCalls).toBe(0);
    expect(fake.state.calls).toBe(0);
  });

  test("refuses streaming before wake or provider I/O", async () => {
    const stub = makeStubAt();
    const fake = makeFakeOpenAI();
    const adapter = new OpenAIResponsesAdapter(fake.client, stub.at);

    await expect(adapter.responses.create({
      model: "gpt-test",
      input: "hello",
      stream: true,
    })).rejects.toThrow(/does not wrap streaming/);
    expect(stub.state.wakeCalls).toBe(0);
    expect(fake.state.calls).toBe(0);
  });

  test("refuses background execution before wake or provider I/O", async () => {
    const stub = makeStubAt();
    const fake = makeFakeOpenAI();
    const adapter = new OpenAIResponsesAdapter(fake.client, stub.at);

    await expect(adapter.responses.create({
      model: "gpt-test",
      input: "hello",
      background: true,
    })).rejects.toThrow(/does not wrap background/);
    expect(stub.state.wakeCalls).toBe(0);
    expect(fake.state.calls).toBe(0);
  });
});

describe("OpenAIResponsesAdapter — decision traces and receipt", () => {
  test("keeps an SDK response prototype and method receiver intact", async () => {
    class SDKResponse {
      readonly id = "resp_class";
      readonly output_text = "class answer";
      private readonly marker = "provider-state";

      readMarker(): string {
        return this.marker;
      }
    }

    const stub = makeStubAt();
    const raw = new SDKResponse();
    Object.defineProperty(raw, "_request_id", {
      value: "req_non_enumerable",
      enumerable: false,
    });
    const fake = makeFakeOpenAI(raw as unknown as OpenAIResponse);
    const adapter = new OpenAIResponsesAdapter(fake.client, stub.at);

    const response = await adapter.responses.create({
      model: "gpt-test",
      input: "hello",
    });

    expect(response).toBe(raw);
    expect(response).toBeInstanceOf(SDKResponse);
    const typed = response as unknown as SDKResponse;
    expect(response.constructor).toBe(SDKResponse);
    expect(typed.readMarker).toBe(typed.readMarker);
    expect(typed.readMarker()).toBe(
      "provider-state",
    );
    expect((response as any)._request_id).toBe("req_non_enumerable");
    expect(Object.keys(response)).not.toContain("_request_id");
    expect(Object.hasOwn(response, "agenttool")).toBe(true);
    expect(Object.keys(response)).not.toContain("agenttool");
    expect(() => structuredClone(response)).not.toThrow();
    expect("agenttool" in response).toBe(true);
  });

  test("falls back safely for a frozen response object", async () => {
    class FrozenSDKResponse {
      readonly id = "resp_frozen";
      readonly output_text = "frozen answer";
      private readonly marker = "frozen-state";

      readMarker(): string {
        return this.marker;
      }
    }

    const stub = makeStubAt();
    const raw = Object.freeze(new FrozenSDKResponse());
    const fake = makeFakeOpenAI(raw as unknown as OpenAIResponse);
    const adapter = new OpenAIResponsesAdapter(fake.client, stub.at);

    const response = await adapter.responses.create({
      model: "gpt-test",
      input: "hello",
    });
    const typed = response as unknown as FrozenSDKResponse;

    expect(response).not.toBe(raw);
    expect(response).toBeInstanceOf(FrozenSDKResponse);
    expect(response.constructor).toBe(FrozenSDKResponse);
    expect(typed.readMarker).toBe(typed.readMarker);
    expect(typed.readMarker()).toBe("frozen-state");
    expect(response.agenttool.wake_used).toBe(true);
  });

  test("records an explicit trace from input and output_text", async () => {
    const stub = makeStubAt();
    const fake = makeFakeOpenAI();
    const adapter = new OpenAIResponsesAdapter(fake.client, stub.at);

    const response = await adapter.responses.create({
      model: "gpt-test",
      input: "Which path?",
      metadata: {
        agenttool: {
          trace: "decision",
          decision_type: "architecture",
          parent_trace_id: "tr_deadbeef",
          tags: ["openai", "responses"],
          agent_id: "agent-a",
        },
      },
    });

    expect(stub.state.requests).toHaveLength(1);
    const body = stub.state.requests[0].body as Record<string, any>;
    expect(body.decision).toEqual({
      type: "architecture",
      summary: "provider answer",
    });
    expect(body.reasoning.observations).toEqual(["Which path?"]);
    expect(body.reasoning.conclusion).toBe("provider answer");
    expect(body.parent_trace_id).toBe("tr_deadbeef");
    expect(body.tags).toEqual(["openai", "responses"]);
    expect(body.agent_id).toBe("agent-a");
    expect(response.agenttool.trace_id).toBe("tr_openai_test");
    expect(response.agenttool.wake_used).toBe(true);
    expect(response.agenttool.cache_eligible).toBe("auto");
    expect(response.id).toBe("resp_test");
  });

  test("reads wire output items and latest user input blocks", async () => {
    const stub = makeStubAt();
    const fake = makeFakeOpenAI({
      id: "resp_wire",
      output: [{
        type: "message",
        content: [
          { type: "output_text", text: "first" },
          { type: "refusal", refusal: "unused" },
          { type: "output_text", text: "second" },
        ],
      }],
    });
    const adapter = new OpenAIResponsesAdapter(fake.client, stub.at);

    await adapter.responses.create({
      model: "gpt-test",
      input: [
        { role: "user", content: "older" },
        { role: "assistant", content: "middle" },
        {
          role: "user",
          content: [
            { type: "input_text", text: "latest A" },
            { type: "input_image", image_url: "https://example.test/a.png" },
            { type: "input_text", text: "latest B" },
          ],
        },
      ],
      metadata: { agenttool: { trace: "decision" } },
    });

    const body = stub.state.requests[0].body as Record<string, any>;
    expect(body.decision.summary).toBe("first\nsecond");
    expect(body.reasoning.observations).toEqual(["latest A\nlatest B"]);
  });

  test("records a pure provider refusal without calling it empty", async () => {
    const stub = makeStubAt();
    const fake = makeFakeOpenAI({
      id: "resp_refusal",
      status: "completed",
      output_text: "",
      output: [{
        type: "message",
        content: [{
          type: "refusal",
          refusal: "I cannot perform that action.",
        }],
      }],
    });
    const adapter = new OpenAIResponsesAdapter(fake.client, stub.at);

    await adapter.responses.create({
      model: "gpt-test",
      input: "do the action",
      metadata: { agenttool: { trace: "decision" } },
    });

    const body = stub.state.requests[0].body as Record<string, any>;
    expect(body.decision.summary).toBe(
      "Refusal: I cannot perform that action.",
    );
    expect(body.reasoning.conclusion).toBe(
      "Refusal: I cannot perform that action.",
    );
  });

  test("does not trace failed, incomplete, queued, or cancelled responses", async () => {
    for (const status of [
      "failed",
      "incomplete",
      "in_progress",
      "queued",
      "cancelled",
    ]) {
      const stub = makeStubAt();
      const fake = makeFakeOpenAI({
        id: `resp_${status}`,
        status,
        output_text: "not a completed decision",
      });
      const adapter = new OpenAIResponsesAdapter(fake.client, stub.at);

      const response = await adapter.responses.create({
        model: "gpt-test",
        input: "hello",
        metadata: { agenttool: { trace: "decision" } },
      });

      expect(stub.state.requests).toHaveLength(0);
      expect(response.agenttool.trace_id).toBeNull();
      expect(response.status).toBe(status);
    }
  });

  test("ambient deciding context triggers and parents a trace", async () => {
    const stub = makeStubAt();
    const fake = makeFakeOpenAI();
    const adapter = new OpenAIResponsesAdapter(fake.client, stub.at);

    const response = await ambientStorage.run(
      { parent_trace_id: "tr_a11b1e", tags: ["ambient"] },
      () => adapter.responses.create({
        model: "gpt-test",
        input: "hello",
        metadata: { agenttool: { tags: ["explicit", "ambient"] } },
      }),
    );

    const body = stub.state.requests[0].body as Record<string, any>;
    expect(body.parent_trace_id).toBe("tr_a11b1e");
    expect(body.tags).toEqual(["explicit", "ambient"]);
    expect(response.agenttool.trace_id).toBe("tr_openai_test");
  });

  test("truncates trace excerpts on whole UTF-16 characters", async () => {
    const stub = makeStubAt();
    const conclusion = `${"a".repeat(199)}😀${"b".repeat(3800)}`;
    const userInput = `${"u".repeat(999)}😀tail`;
    const fake = makeFakeOpenAI({
      id: "resp_unicode",
      output_text: conclusion,
      output: [],
    });
    const adapter = new OpenAIResponsesAdapter(fake.client, stub.at);

    await adapter.responses.create({
      model: "gpt-test",
      input: userInput,
      metadata: { agenttool: { trace: "decision", skip_wake: true } },
    });

    const body = stub.state.requests[0].body as Record<string, any>;
    expect(body.decision.summary).toBe("a".repeat(199));
    expect(body.reasoning.observations).toEqual(["u".repeat(999)]);
    expect(body.reasoning.conclusion).toBe(
      `${"a".repeat(199)}😀${"b".repeat(3799)}`,
    );
    expect(body.reasoning.conclusion.length).toBe(4000);
  });

  test("trace failure keeps the completed provider response", async () => {
    const stub = makeStubAt({
      requestImpl: async () => {
        throw new Error("trace store unavailable");
      },
    });
    const fake = makeFakeOpenAI();
    const adapter = new OpenAIResponsesAdapter(fake.client, stub.at);

    const response = await adapter.responses.create({
      model: "gpt-test",
      input: "hello",
      metadata: { agenttool: { trace: "decision" } },
    });

    expect(response.id).toBe("resp_test");
    expect(response.output_text).toBe("provider answer");
    expect(response.agenttool.trace_id).toBeNull();
  });
});
