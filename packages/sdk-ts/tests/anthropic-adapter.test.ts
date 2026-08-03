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
import { ambientStorage } from "../src/_context";
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

class FakeLowLevelStream implements AsyncIterable<unknown> {
  readonly controller = new AbortController();
  readonly label = "provider-low-level-stream";
  returnCount = 0;
  throwCount = 0;
  abortCount = 0;
  closeCount = 0;
  private index = 0;

  constructor(readonly events: unknown[]) {}

  [Symbol.asyncIterator](): AsyncIterator<unknown> {
    return {
      next: async () => {
        if (this.index >= this.events.length) {
          return { value: undefined, done: true };
        }
        return { value: this.events[this.index++], done: false };
      },
      return: async (value?: unknown) => {
        this.returnCount++;
        return { value, done: true };
      },
      throw: async (error?: unknown) => {
        this.throwCount++;
        throw error;
      },
    };
  }

  abort(): void {
    this.abortCount++;
    this.controller.abort();
  }

  close(): void {
    this.closeCount++;
  }
}

type Listener = (...args: unknown[]) => void;

class FakeManagedStream implements AsyncIterable<unknown> {
  readonly controller = new AbortController();
  readonly response = { status: 200 };
  readonly request_id = "req_fake_stream";
  finalMessageCalls = 0;
  returnCount = 0;
  throwCount = 0;
  abortCount = 0;
  closeCount = 0;
  private index = 0;
  private ended = false;
  protected readonly listeners = new Map<
    string,
    Array<{ listener: Listener; once: boolean }>
  >();

  constructor(
    readonly events: unknown[],
    readonly finalResponse: Record<string, unknown>,
  ) {}

  on(event: string, listener: Listener): this {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push({ listener, once: false });
    this.listeners.set(event, listeners);
    return this;
  }

  once(event: string, listener: Listener): this {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push({ listener, once: true });
    this.listeners.set(event, listeners);
    return this;
  }

  off(event: string, listener: Listener): this {
    const listeners = this.listeners.get(event) ?? [];
    const index = listeners.findIndex((entry) => entry.listener === listener);
    if (index >= 0) listeners.splice(index, 1);
    return this;
  }

  async finalMessage(): Promise<any> {
    this.finalMessageCalls++;
    return this.finalResponse;
  }

  async withResponse(): Promise<Record<string, unknown>> {
    return {
      data: this,
      response: this.response,
      request_id: this.request_id,
    };
  }

  toReadableStream(): string {
    return "provider-readable-stream";
  }

  abort(): void {
    this.abortCount++;
    this.controller.abort();
  }

  close(): void {
    this.closeCount++;
  }

  [Symbol.asyncIterator](): AsyncIterator<unknown> {
    return {
      next: async () => {
        if (this.index < this.events.length) {
          return { value: this.events[this.index++], done: false };
        }
        if (!this.ended) {
          this.ended = true;
          this.emit("finalMessage", this.finalResponse);
          this.emit("end");
        }
        return { value: undefined, done: true };
      },
      return: async (value?: unknown) => {
        this.returnCount++;
        return { value, done: true };
      },
      throw: async (error?: unknown) => {
        this.throwCount++;
        throw error;
      },
    };
  }

  emit(event: string, ...args: unknown[]): void {
    const listeners = this.listeners.get(event) ?? [];
    this.listeners.set(
      event,
      listeners.filter((entry) => !entry.once),
    );
    for (const entry of listeners) entry.listener(...args);
  }
}

/**
 * Mirrors the official MessageStream `_run()` timing when its internal
 * `messages.create()` call throws synchronously: the async executor is already
 * rejected, so its error reaction is queued before `messages.stream()` returns.
 */
class OfficialStyleImmediateFailureStream extends FakeManagedStream {
  unobservedErrors = 0;

  constructor(readonly failure: Error) {
    super([], {
      id: "msg_never_completed",
      model: "claude-test",
      content: [],
    });
    const createMessage = async (): Promise<void> => {
      throw failure;
    };
    void createMessage().then(
      () => {},
      (error) => {
        if ((this.listeners.get("error") ?? []).length === 0) {
          this.unobservedErrors++;
        }
        this.emit("error", error);
        this.emit("end");
      },
    );
  }

  override async finalMessage(): Promise<any> {
    this.finalMessageCalls++;
    throw this.failure;
  }
}

class ControlledNextStream extends FakeManagedStream {
  private markReadStarted!: () => void;
  private resolveRead:
    | ((result: IteratorResult<unknown>) => void)
    | undefined;
  readonly readStarted = new Promise<void>((resolve) => {
    this.markReadStarted = resolve;
  });

  resolveNext(result: IteratorResult<unknown>): void {
    if (!this.resolveRead) throw new Error("next() has not started");
    this.resolveRead(result);
  }

  override [Symbol.asyncIterator](): AsyncIterator<unknown> {
    return {
      next: () => {
        this.markReadStarted();
        return new Promise<IteratorResult<unknown>>((resolve) => {
          this.resolveRead = resolve;
        });
      },
      return: async (value?: unknown) => {
        this.returnCount++;
        return { value, done: true };
      },
      throw: async (error?: unknown) => {
        this.throwCount++;
        throw error;
      },
    };
  }
}

function makeFakeStreamingAnthropic(
  events: unknown[],
  finalText = "stream complete",
) {
  const low = new FakeLowLevelStream(events);
  const managed = new FakeManagedStream(events, {
    id: "msg_stream_final",
    model: "claude-test",
    content: [{ type: "text", text: finalText }],
    stop_reason: "end_turn",
  });
  const state = {
    createCalls: 0,
    streamCalls: 0,
    createParams: null as Record<string, unknown> | null,
    streamParams: null as Record<string, unknown> | null,
    createOptions: [] as unknown[],
    streamOptions: [] as unknown[],
  };
  const client = {
    messages: {
      create: async (
        params: Record<string, unknown>,
        ...requestOptions: unknown[]
      ) => {
        state.createCalls++;
        state.createParams = params;
        state.createOptions = requestOptions;
        return low;
      },
      stream: (
        params: Record<string, unknown>,
        ...requestOptions: unknown[]
      ) => {
        state.streamCalls++;
        state.streamParams = params;
        state.streamOptions = requestOptions;
        return managed;
      },
    },
  };
  return { client, low, managed, state };
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

// ── Streaming boundaries ────────────────────────────────────────────────

describe("AnthropicAdapter — low-level messages.create streaming", () => {
  test("passes unknown events through by reference and keeps AgentTool local", async () => {
    const unknownEvent = {
      type: "future_provider_event",
      nested: { value: 7 },
    };
    const stub = makeStubAt();
    const fake = makeFakeStreamingAnthropic([unknownEvent]);
    const adapter = new AnthropicAdapter(fake.client, stub.at);
    const requestOptions = { timeout: 1234 };

    const stream = await adapter.messages.create(
      {
        model: "claude-test",
        max_tokens: 100,
        stream: true,
        messages: [{ role: "user", content: "hi" }],
        metadata: {
          agenttool: { skip_markup: false },
          user_id: "provider-user",
        },
      },
      requestOptions,
    );

    const received: unknown[] = [];
    for await (const event of stream) received.push(event);

    expect(received).toHaveLength(1);
    expect(received[0]).toBe(unknownEvent);
    expect(stream.agenttool).toEqual({
      trace_id: null,
      wake_used: true,
      cache_eligible: "explicit",
      markup_emissions: [],
    });
    expect(stub.recorded).toEqual([]);
    expect(fake.state.createOptions).toEqual([requestOptions]);
    expect((fake.state.createParams!.metadata as any).agenttool).toBeUndefined();
    expect((fake.state.createParams!.metadata as any).user_id).toBe(
      "provider-user",
    );
    const system = fake.state.createParams!.system as Array<{ text: string }>;
    expect(system[0].text).toBe("STABLE_WAKE");
  });

  test("delegates iterator return/throw plus abort and close", async () => {
    const stub = makeStubAt();
    const fake = makeFakeStreamingAnthropic([{ type: "message_start" }]);
    const adapter = new AnthropicAdapter(fake.client, stub.at);
    const stream = await adapter.messages.create({
      model: "claude-test",
      max_tokens: 100,
      stream: true,
      messages: [{ role: "user", content: "hi" }],
    });

    const firstIterator = stream[Symbol.asyncIterator]();
    await firstIterator.next();
    await firstIterator.return?.("stop");
    expect(fake.low.returnCount).toBe(1);

    const secondIterator = stream[Symbol.asyncIterator]();
    const thrown = new Error("consumer stopped");
    try {
      await secondIterator.throw?.(thrown);
    } catch (err) {
      expect(err).toBe(thrown);
    }
    expect(fake.low.throwCount).toBe(1);

    stream.abort?.();
    stream.close?.();
    expect(fake.low.abortCount).toBe(1);
    expect(fake.low.closeCount).toBe(1);
    expect((stream as any).label).toBe("provider-low-level-stream");
  });

  test("uses an invariant-safe shell for a frozen stream with own methods", async () => {
    const event = { type: "future_provider_event" };
    let index = 0;
    let abortCalls = 0;
    let closeCalls = 0;
    const provider = Object.freeze({
      controller: new AbortController(),
      [Symbol.asyncIterator]: function (): AsyncIterator<unknown> {
        return {
          next: async () =>
            index++ === 0
              ? { value: event, done: false }
              : { value: undefined, done: true },
        };
      },
      abort: function (): void {
        abortCalls++;
      },
      close: function (): void {
        closeCalls++;
      },
    });
    expect(
      Object.getOwnPropertyDescriptor(provider, Symbol.asyncIterator)
        ?.configurable,
    ).toBe(false);

    const client = {
      messages: {
        create: async () => provider,
      },
    };
    const stub = makeStubAt();
    const stream = await new AnthropicAdapter(client, stub.at).messages.create({
      model: "claude-test",
      max_tokens: 100,
      stream: true,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(stream).not.toBe(provider);
    expect((await stream[Symbol.asyncIterator]().next()).value).toBe(event);
    stream.abort?.();
    stream.close?.();
    expect(abortCalls).toBe(1);
    expect(closeCalls).toBe(1);
    expect(stream.agenttool.cache_eligible).toBe("explicit");
    expect(Object.keys(stream)).not.toContain("agenttool");
    expect(Reflect.set(stream, "extra", true)).toBe(false);
  });

  test("cleans up a non-iterable provider stream before rejecting", async () => {
    let closeCalls = 0;
    let abortCalls = 0;
    const invalid = {
      close: async () => {
        closeCalls++;
      },
      abort: () => {
        abortCalls++;
      },
    };
    const client = {
      messages: {
        create: async () => invalid,
      },
    };
    const stub = makeStubAt();
    const adapter = new AnthropicAdapter(client, stub.at);

    await expect(
      adapter.messages.create({
        model: "claude-test",
        max_tokens: 100,
        stream: true,
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toMatchObject({
      code: "anthropic_stream_invalid",
    });
    expect(closeCalls).toBe(1);
    expect(abortCalls).toBe(0);
  });

  test("cleans up when the provider iterator getter throws", async () => {
    const getterError = new Error("poisoned iterator getter");
    let closeCalls = 0;
    const invalid = {
      close: async () => {
        closeCalls++;
      },
      get [Symbol.asyncIterator](): never {
        throw getterError;
      },
    };
    const client = {
      messages: {
        create: async () => invalid,
      },
    };
    const adapter = new AnthropicAdapter(client, makeStubAt().at);

    await expect(
      adapter.messages.create({
        model: "claude-test",
        max_tokens: 100,
        stream: true,
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toMatchObject({
      code: "anthropic_stream_invalid",
    });
    expect(closeCalls).toBe(1);
  });

  test("cleans up when local stream augmentation throws", async () => {
    const augmentationError = new Error("augmentation trap failed");
    let closeCalls = 0;
    const target = {
      close: async () => {
        closeCalls++;
      },
      [Symbol.asyncIterator](): AsyncIterator<unknown> {
        return {
          next: async () => ({ value: undefined, done: true }),
        };
      },
    };
    const provider = new Proxy(target, {
      has() {
        throw augmentationError;
      },
    });
    const client = {
      messages: {
        create: async () => provider,
      },
    };
    const adapter = new AnthropicAdapter(client, makeStubAt().at);

    await expect(
      adapter.messages.create({
        model: "claude-test",
        max_tokens: 100,
        stream: true,
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toBe(augmentationError);
    expect(closeCalls).toBe(1);
  });

  test("refuses explicit decision tracing before wake or provider I/O", async () => {
    const stub = makeStubAt();
    const fake = makeFakeStreamingAnthropic([]);
    const adapter = new AnthropicAdapter(fake.client, stub.at);

    await expect(
      adapter.messages.create({
        model: "claude-test",
        max_tokens: 100,
        stream: true,
        messages: [{ role: "user", content: "hi" }],
        metadata: { agenttool: { trace: "decision" } },
      }),
    ).rejects.toMatchObject({
      code: "anthropic_stream_trace_requires_helper",
    });
    expect(stub.wakeCalls).toBe(0);
    expect(fake.state.createCalls).toBe(0);
  });

  test("refuses ambient decision tracing before wake or provider I/O", async () => {
    const stub = makeStubAt();
    const fake = makeFakeStreamingAnthropic([]);
    const adapter = new AnthropicAdapter(fake.client, stub.at);

    await expect(
      ambientStorage.run(
        { parent_trace_id: "tr_parent", tags: ["ambient"] },
        () =>
          adapter.messages.create({
            model: "claude-test",
            max_tokens: 100,
            stream: true,
            messages: [{ role: "user", content: "hi" }],
          }),
      ),
    ).rejects.toMatchObject({
      code: "anthropic_stream_trace_requires_helper",
    });
    expect(stub.wakeCalls).toBe(0);
    expect(fake.state.createCalls).toBe(0);
  });
});

describe("AnthropicAdapter — messages.stream helper", () => {
  test("finalizes the provider message exactly once after unchanged events", async () => {
    const unknownEvent = {
      type: "future_provider_event",
      payload: { still: "opaque" },
    };
    const finalText =
      "done <agenttool><chronicle type=\"recognition\"><title>Streamed</title></chronicle></agenttool>";
    const stub = makeStubAt();
    const fake = makeFakeStreamingAnthropic([unknownEvent], finalText);
    // The streamed response carries a <chronicle> tag; model-authored
    // chronicle writes are gated, so the review hook is what lets this
    // test still assert the emission it is about.
    const adapter = new AnthropicAdapter(fake.client, stub.at, {
      beforeChronicleWrite: () => true,
    });
    const requestOptions = { signal: "provider-option-marker" };

    const stream = ambientStorage.run(
      { parent_trace_id: "tr_parent", tags: ["streamed"] },
      () => adapter.messages.stream({
        model: "claude-test",
        max_tokens: 100,
        messages: [{ role: "user", content: "decide" }],
        metadata: {
          user_id: "provider-user",
        },
      }, requestOptions),
    );

    // The adapter remains a synchronous helper even though wake is async.
    expect(typeof stream.finalMessage).toBe("function");
    const received: unknown[] = [];
    for await (const event of stream) received.push(event);
    expect(received[0]).toBe(unknownEvent);

    const first = await stream.finalMessage();
    const second = await stream.finalMessage();
    expect(first).toBe(second);
    expect(await stream.emitted("end")).toBeUndefined();
    expect(first).toBe(fake.managed.finalResponse);
    expect(
      Object.getOwnPropertyDescriptor(first, "agenttool")?.enumerable,
    ).toBe(false);
    expect(fake.managed.finalMessageCalls).toBe(1);
    expect(first.agenttool.trace_id).toBe("tr_test_1");
    expect(first.agenttool.markup_emissions).toHaveLength(1);
    expect(first.agenttool.markup_emissions[0].kind).toBe("chronicle");
    expect(stream.agenttool).toBe(first.agenttool);

    expect(fake.state.streamCalls).toBe(1);
    expect(fake.state.streamOptions).toEqual([requestOptions]);
    expect((fake.state.streamParams!.metadata as any).agenttool).toBeUndefined();
    expect((fake.state.streamParams!.metadata as any).user_id).toBe(
      "provider-user",
    );
    const traceCalls = stub.recorded.filter((call) => call.path === "/v1/traces");
    expect(traceCalls).toHaveLength(1);
    expect((traceCalls[0].body as any).parent_trace_id).toBe("tr_parent");
    expect((traceCalls[0].body as any).tags).toEqual(["streamed"]);
    expect(stub.recorded.filter((call) => call.path === "/v1/chronicle")).toHaveLength(1);
  });

  test("snapshots trace metadata and input before stream finalization", async () => {
    const stub = makeStubAt();
    const fake = makeFakeStreamingAnthropic([], "original conclusion");
    const adapter = new AnthropicAdapter(fake.client, stub.at);
    const localMetadata: {
      trace: "decision" | false;
      tags: string[];
    } = {
      trace: "decision",
      tags: ["original-tag"],
    };
    const messages = [{ role: "user", content: "original question" }];
    const stream = adapter.messages.stream({
      model: "claude-test",
      max_tokens: 100,
      messages,
      metadata: { agenttool: localMetadata },
    });

    // Provider construction has finished, but durable trace finalization has
    // not. Later caller mutations must not rewrite the call's local policy or
    // the observation describing the input already sent to the provider.
    await stream.withResponse();
    localMetadata.trace = false;
    localMetadata.tags.push("late-tag");
    messages[0].content = "late replacement question";

    await stream.finalMessage();

    const traceCalls = stub.recorded.filter((call) =>
      call.path === "/v1/traces"
    );
    expect(traceCalls).toHaveLength(1);
    const body = traceCalls[0].body as any;
    expect(body.tags).toEqual(["original-tag"]);
    expect(body.reasoning.observations).toEqual(["original question"]);
  });

  test("completion settles an already-in-flight next without late data", async () => {
    const lateEvent = { type: "late_provider_event" };
    const provider = new ControlledNextStream([], {
      id: "msg_completed_while_reading",
      model: "claude-test",
      content: [{ type: "text", text: "complete" }],
    });
    const client = {
      messages: {
        create: async () => provider,
        stream: () => provider,
      },
    };
    const stream = new AnthropicAdapter(
      client,
      makeStubAt().at,
    ).messages.stream({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    });
    const iterator = stream[Symbol.asyncIterator]();
    const pendingNext = iterator.next();
    await provider.readStarted;

    await stream.finalMessage();
    expect(await pendingNext).toEqual({
      value: undefined,
      done: true,
    });

    // The provider read can settle later, but its data cannot cross the
    // facade's already-completed terminal boundary.
    provider.resolveNext({ value: lateEvent, done: false });
    await Promise.resolve();
    expect(await iterator.next()).toEqual({
      value: undefined,
      done: true,
    });
  });

  test("post-await next fence preserves failure and cancellation", async () => {
    const failureProvider = new ControlledNextStream([], {
      id: "msg_failed_while_reading",
      model: "claude-test",
      content: [{ type: "text", text: "never returned" }],
    });
    const failureClient = {
      messages: {
        create: async () => failureProvider,
        stream: () => failureProvider,
      },
    };
    const failedStream = new AnthropicAdapter(
      failureClient,
      makeStubAt().at,
    ).messages.stream({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    });
    const failedIterator = failedStream[Symbol.asyncIterator]();
    const failedNext = failedIterator.next();
    await failureProvider.readStarted;
    failureProvider.resolveNext({
      value: { type: "must_not_escape" },
      done: false,
    });
    const providerFailure = new Error("provider failed after resolving read");
    failureProvider.emit("error", providerFailure);

    await expect(failedNext).rejects.toBe(providerFailure);
    await expect(failedStream.finalMessage()).rejects.toBe(providerFailure);

    const cancelledProvider = new ControlledNextStream([], {
      id: "msg_cancelled_while_reading",
      model: "claude-test",
      content: [{ type: "text", text: "never returned" }],
    });
    const cancellationClient = {
      messages: {
        create: async () => cancelledProvider,
        stream: () => cancelledProvider,
      },
    };
    const cancelledStream = new AnthropicAdapter(
      cancellationClient,
      makeStubAt().at,
    ).messages.stream({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    });
    const cancelledIterator = cancelledStream[Symbol.asyncIterator]();
    const cancelledNext = cancelledIterator.next();
    await cancelledProvider.readStarted;
    cancelledProvider.resolveNext({
      value: { type: "must_not_escape" },
      done: false,
    });
    cancelledStream.abort();

    expect(await cancelledNext).toEqual({
      value: undefined,
      done: true,
    });
  });

  test("iterator construction failure becomes the exact terminal error", async () => {
    const iteratorError = new Error("provider iterator construction failed");
    class ThrowingIteratorStream extends FakeManagedStream {
      override [Symbol.asyncIterator](): AsyncIterator<unknown> {
        throw iteratorError;
      }
    }
    const provider = new ThrowingIteratorStream([], {
      id: "msg_iterator_failed",
      model: "claude-test",
      content: [{ type: "text", text: "must not finalize" }],
    });
    const client = {
      messages: {
        create: async () => provider,
        stream: () => provider,
      },
    };
    const stub = makeStubAt();
    const stream = new AnthropicAdapter(client, stub.at).messages.stream({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
      metadata: { agenttool: { trace: "decision" } },
    });

    await expect(
      stream[Symbol.asyncIterator]().next(),
    ).rejects.toBe(iteratorError);
    await expect(stream.finalMessage()).rejects.toBe(iteratorError);
    expect(provider.abortCount).toBe(1);
    expect(provider.finalMessageCalls).toBe(0);
    expect(stub.recorded).toEqual([]);
  });

  test("early iterator return delegates cleanup and does not finalize", async () => {
    const finalText =
      "partial <agenttool><chronicle type=\"recognition\"><title>Too late</title></chronicle></agenttool>";
    const stub = makeStubAt();
    const fake = makeFakeStreamingAnthropic([
      { type: "message_start" },
      { type: "message_delta" },
    ], finalText);
    const adapter = new AnthropicAdapter(fake.client, stub.at);
    const stream = adapter.messages.stream({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
      metadata: { agenttool: { trace: "decision" } },
    });

    const iterator = stream[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.return?.("stop");
    fake.managed.emit("finalMessage", fake.managed.finalResponse);
    expect(await iterator.next()).toEqual({ value: undefined, done: true });
    await Promise.resolve();
    expect(fake.managed.returnCount).toBe(1);
    expect(fake.managed.finalMessageCalls).toBe(0);

    await expect(stream.finalMessage()).rejects.toMatchObject({
      code: "anthropic_stream_aborted",
    });
    stream.abort();
    await stream.close();
    expect(fake.managed.abortCount).toBe(0);
    expect(fake.managed.closeCount).toBe(0);
    expect(stub.recorded).toEqual([]);
  });

  test("abort and close are idempotent terminal fences", async () => {
    const finalText =
      "partial <agenttool><chronicle type=\"recognition\"><title>Too late</title></chronicle></agenttool>";

    const abortStub = makeStubAt();
    const abortFake = makeFakeStreamingAnthropic([
      { type: "message_start" },
    ], finalText);
    const abortStream = new AnthropicAdapter(
      abortFake.client,
      abortStub.at,
    ).messages.stream({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "secret partial input" }],
      metadata: { agenttool: { trace: "decision" } },
    });
    await abortStream[Symbol.asyncIterator]().next();
    abortStream.abort();
    abortStream.abort();
    await abortStream.close();
    abortFake.managed.emit(
      "finalMessage",
      abortFake.managed.finalResponse,
    );
    await Promise.resolve();
    expect(abortFake.managed.abortCount).toBe(1);
    expect(abortFake.managed.closeCount).toBe(0);
    expect(abortFake.managed.finalMessageCalls).toBe(0);
    expect(abortStub.recorded).toEqual([]);

    const closeStub = makeStubAt();
    const closeFake = makeFakeStreamingAnthropic([
      { type: "message_start" },
    ], finalText);
    const closeStream = new AnthropicAdapter(
      closeFake.client,
      closeStub.at,
    ).messages.stream({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "secret partial input" }],
      metadata: { agenttool: { trace: "decision" } },
    });
    await closeStream[Symbol.asyncIterator]().next();
    await closeStream.close();
    await closeStream.close();
    closeStream.abort();
    closeFake.managed.emit(
      "finalMessage",
      closeFake.managed.finalResponse,
    );
    await Promise.resolve();
    expect(closeFake.managed.closeCount).toBe(1);
    expect(closeFake.managed.abortCount).toBe(0);
    expect(closeFake.managed.finalMessageCalls).toBe(0);
    expect(closeStub.recorded).toEqual([]);
  });

  test("reentrant close waits for the first asynchronous cleanup", async () => {
    let releaseAbort!: () => void;
    const abortMayFinish = new Promise<void>((resolve) => {
      releaseAbort = resolve;
    });
    let abortFinished = false;
    class SlowAbortStream extends FakeManagedStream {
      override async abort(): Promise<void> {
        this.abortCount++;
        this.emit("abort", new Error("provider aborting"));
        await abortMayFinish;
        abortFinished = true;
      }
    }

    const provider = new SlowAbortStream([], {
      id: "msg_stream_final",
      model: "claude-test",
      content: [{ type: "text", text: "done" }],
    });
    const client = {
      messages: {
        create: async () => provider,
        stream: () => provider,
      },
    };
    const stub = makeStubAt();
    const stream = new AnthropicAdapter(
      client as any,
      stub.at,
    ).messages.stream({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    });

    let reentrantClose: Promise<void> | undefined;
    let closeResolved = false;
    stream.on("abort", () => {
      reentrantClose = stream.close().then(() => {
        closeResolved = true;
      });
    });
    await stream.withResponse();
    stream.abort();
    await Promise.resolve();

    expect(provider.abortCount).toBe(1);
    expect(abortFinished).toBe(false);
    expect(closeResolved).toBe(false);
    expect(reentrantClose).toBeDefined();

    releaseAbort();
    await reentrantClose;
    expect(abortFinished).toBe(true);
    expect(closeResolved).toBe(true);
    expect(provider.abortCount).toBe(1);
  });

  test("dispatches lazy initialization failures to event listeners and promises", async () => {
    const failure = new Error("wake failed");
    const stub = makeStubAt({ wakeShape: Promise.reject(failure) });
    const fake = makeFakeStreamingAnthropic([]);
    const stream = new AnthropicAdapter(
      fake.client,
      stub.at,
    ).messages.stream({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    });

    let observed: unknown;
    let endCalls = 0;
    stream.on("error", (error) => {
      observed = error;
    });
    stream.on("end", () => {
      endCalls++;
    });
    const errorEvent = stream.emitted("error");
    const endEvent = stream.emitted("end");

    await expect(stream.finalMessage()).rejects.toBe(failure);
    expect(await errorEvent).toBe(failure);
    expect(await endEvent).toBeUndefined();
    expect(observed).toBe(failure);
    expect(endCalls).toBe(1);
    expect(fake.state.streamCalls).toBe(0);

    let lateObserved: unknown;
    stream.once("error", (error) => {
      lateObserved = error;
    });
    expect(lateObserved).toBe(failure);
  });

  test("attaches queued listeners before an official-style immediate error", async () => {
    const failure = new Error("synchronous provider create failure");
    let provider!: OfficialStyleImmediateFailureStream;
    const client = {
      messages: {
        create: async () => ({}),
        stream: () => {
          provider = new OfficialStyleImmediateFailureStream(failure);
          return provider;
        },
      },
    };
    const stub = makeStubAt();
    const stream = new AnthropicAdapter(client, stub.at).messages.stream({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    });

    let observedError: unknown;
    let endCalls = 0;
    stream.on("error", (error) => {
      observedError = error;
    });
    stream.on("end", () => {
      endCalls++;
    });
    const errorEvent = stream.emitted("error");
    const endEvent = stream.emitted("end");

    expect(await errorEvent).toBe(failure);
    expect(await endEvent).toBeUndefined();
    await expect(stream.finalMessage()).rejects.toBe(failure);
    expect(observedError).toBe(failure);
    expect(endCalls).toBe(1);
    expect(provider.unobservedErrors).toBe(0);
  });

  test("settles already-forwarded emitted promises on quiet cancellation", async () => {
    const fake = makeFakeStreamingAnthropic([]);
    const stub = makeStubAt();
    const stream = new AnthropicAdapter(fake.client, stub.at).messages.stream({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    });
    await stream.withResponse();

    const abortEvent = stream.emitted("abort");
    const endEvent = stream.emitted("end");
    const errorEvent = stream.emitted("error");
    const messageEvent = stream.emitted("message");
    void errorEvent.catch(() => {});
    void messageEvent.catch(() => {});
    stream.abort();

    expect(await abortEvent).toMatchObject({
      code: "anthropic_stream_aborted",
    });
    expect(await endEvent).toBeUndefined();
    await expect(errorEvent).rejects.toMatchObject({
      code: "anthropic_stream_aborted",
    });
    await expect(messageEvent).rejects.toMatchObject({
      code: "anthropic_stream_aborted",
    });
    expect(fake.managed.abortCount).toBe(1);
  });

  test("preserves a direct controller cancellation reason", async () => {
    const fake = makeFakeStreamingAnthropic([]);
    const stream = new AnthropicAdapter(
      fake.client,
      makeStubAt().at,
    ).messages.stream({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    });
    await stream.withResponse();

    const reason = new Error("caller stopped the stream");
    const abortEvent = stream.emitted("abort");
    const endEvent = stream.emitted("end");
    stream.controller.abort(reason);

    expect(await abortEvent).toBe(reason);
    expect(await endEvent).toBeUndefined();
    await expect(stream.finalMessage()).rejects.toBe(reason);
    expect(fake.managed.abortCount).toBe(1);
  });

  test("settles emitted error and end when finalMessage fails quietly", async () => {
    const failure = new Error("quiet final-message failure");
    class QuietFailureStream extends FakeManagedStream {
      override async finalMessage(): Promise<any> {
        this.finalMessageCalls++;
        throw failure;
      }
    }
    const provider = new QuietFailureStream([], {
      id: "msg_never_completed",
      model: "claude-test",
      content: [],
    });
    const client = {
      messages: {
        create: async () => provider,
        stream: () => provider,
      },
    };
    const stream = new AnthropicAdapter(
      client,
      makeStubAt().at,
    ).messages.stream({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    });
    await stream.withResponse();

    const errorEvent = stream.emitted("error");
    const endEvent = stream.emitted("end");
    const abortEvent = stream.emitted("abort");
    void abortEvent.catch(() => {});
    await expect(stream.finalMessage()).rejects.toBe(failure);
    expect(await errorEvent).toBe(failure);
    expect(await endEvent).toBeUndefined();
    await expect(abortEvent).rejects.toBe(failure);
    expect(provider.finalMessageCalls).toBe(1);
  });

  test("pre-provider cancellation emits abort and end once", async () => {
    let releaseWake!: (shape: unknown) => void;
    const wakeShape = new Promise<unknown>((resolve) => {
      releaseWake = resolve;
    });
    const stub = makeStubAt({ wakeShape });
    const fake = makeFakeStreamingAnthropic([]);
    const stream = new AnthropicAdapter(fake.client, stub.at).messages.stream({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    });

    let abortCalls = 0;
    let endCalls = 0;
    let errorCalls = 0;
    stream.on("abort", () => {
      abortCalls++;
    });
    stream.on("end", () => {
      endCalls++;
    });
    stream.on("error", () => {
      errorCalls++;
    });
    const abortEvent = stream.emitted("abort");
    const endEvent = stream.emitted("end");
    const errorEvent = stream.emitted("error");
    void errorEvent.catch(() => {});

    await stream.close();
    expect(await abortEvent).toMatchObject({
      code: "anthropic_stream_aborted",
    });
    expect(await endEvent).toBeUndefined();
    await expect(errorEvent).rejects.toMatchObject({
      code: "anthropic_stream_aborted",
    });
    expect(abortCalls).toBe(1);
    expect(endCalls).toBe(1);
    expect(errorCalls).toBe(0);

    releaseWake({
      system: [],
      _meta: {
        provider: "anthropic",
        cache_eligible: "explicit",
        cache_note: "test",
      },
    });
    await Promise.resolve();
    expect(fake.state.streamCalls).toBe(0);
  });

  test("on-only provider abort stops every later finalization side effect", async () => {
    let traceStartedResolve: (() => void) | undefined;
    let releaseTrace: (() => void) | undefined;
    const traceStarted = new Promise<void>((resolve) => {
      traceStartedResolve = resolve;
    });
    const stub = makeStubAt({
      requestImpl: (_method, path) => {
        if (path !== "/v1/traces") return Promise.resolve({ id: "too_late" });
        traceStartedResolve?.();
        return new Promise((resolve) => {
          releaseTrace = () => resolve({ trace_id: "tr_in_flight" });
        });
      },
    });
    const finalText =
      "partial <agenttool><chronicle type=\"recognition\"><title>Must not post</title></chronicle></agenttool>";
    const fake = makeFakeStreamingAnthropic([], finalText);
    // The adapter accepts custom helpers whose event surface has `on` but no
    // `once`; terminal observation must still work for them.
    (fake.managed as any).once = undefined;
    const stream = new AnthropicAdapter(
      fake.client,
      stub.at,
    ).messages.stream({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "secret partial input" }],
      metadata: { agenttool: { trace: "decision" } },
    });

    const abortEvent = stream.emitted("abort");
    const endEvent = stream.emitted("end");
    const errorEvent = stream.emitted("error");
    void errorEvent.catch(() => {});
    const finalMessage = stream.finalMessage();
    await traceStarted;
    const providerAbort = new Error("provider aborted");
    fake.managed.emit("abort", providerAbort);
    expect(stream.controller.signal.aborted).toBe(true);
    releaseTrace?.();

    await expect(finalMessage).rejects.toBe(providerAbort);
    expect(await abortEvent).toBe(providerAbort);
    expect(await endEvent).toBeUndefined();
    await expect(errorEvent).rejects.toBe(providerAbort);
    expect(stub.recorded.map((call) => call.path)).toEqual([
      "/v1/traces",
    ]);
    expect(
      stub.recorded.some((call) => call.path === "/v1/chronicle"),
    ).toBe(false);
  });

  test("detects a provider signal that aborted before listener registration", async () => {
    const finalText =
      "partial <agenttool><chronicle type=\"recognition\"><title>Must not post</title></chronicle></agenttool>";
    const stub = makeStubAt();
    const fake = makeFakeStreamingAnthropic([], finalText);
    (fake.managed as any).once = undefined;
    fake.managed.controller.abort(new Error("already aborted"));
    const providerReason = fake.managed.controller.signal.reason;
    const stream = new AnthropicAdapter(
      fake.client,
      stub.at,
    ).messages.stream({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "secret partial input" }],
      metadata: { agenttool: { trace: "decision" } },
    });
    const abortEvent = stream.emitted("abort");
    const endEvent = stream.emitted("end");
    const errorEvent = stream.emitted("error");
    void errorEvent.catch(() => {});

    await expect(stream.finalMessage()).rejects.toBe(providerReason);
    expect(await abortEvent).toBe(providerReason);
    expect(await endEvent).toBeUndefined();
    await expect(errorEvent).rejects.toBe(providerReason);
    expect(stream.controller.signal.aborted).toBe(true);
    expect(fake.managed.finalMessageCalls).toBe(0);
    expect(stub.recorded).toEqual([]);
  });

  test("listener registration failures reject queued promises and clean up", async () => {
    const registrationError = new Error("listener registration failed");
    class ThrowingListenerStream extends FakeManagedStream {
      override once(event: string, listener: Listener): this {
        if (event === "bad") throw registrationError;
        return super.once(event, listener);
      }
    }

    const provider = new ThrowingListenerStream([], {
      id: "msg_stream_final",
      model: "claude-test",
      content: [{ type: "text", text: "done" }],
    });
    const client = {
      messages: {
        create: async () => provider,
        stream: () => provider,
      },
    };
    const stub = makeStubAt();
    const stream = new AnthropicAdapter(
      client as any,
      stub.at,
    ).messages.stream({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    });
    const badEvent = stream.emitted("bad");
    const finalMessage = stream.finalMessage();
    void badEvent.catch(() => {});
    void finalMessage.catch(() => {});

    await expect(finalMessage).rejects.toBe(registrationError);
    await expect(badEvent).rejects.toBe(registrationError);
    expect(provider.abortCount).toBe(1);
    await stream.close();
    expect(provider.abortCount).toBe(1);
  });

  test("cleans up an invalid helper before rejecting it", async () => {
    let closeCalls = 0;
    let abortCalls = 0;
    const invalid = {
      close() {
        closeCalls++;
      },
      abort() {
        abortCalls++;
      },
      [Symbol.asyncIterator](): AsyncIterator<unknown> {
        return {
          next: async () => ({ value: undefined, done: true }),
        };
      },
    };
    const client = {
      messages: {
        create: async () => ({
          id: "unused",
          model: "claude-test",
        }),
        stream: () => invalid,
      },
    };
    const stub = makeStubAt();
    const stream = new AnthropicAdapter(
      client as any,
      stub.at,
    ).messages.stream({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    });

    await expect(stream.finalMessage()).rejects.toMatchObject({
      code: "anthropic_stream_helper_invalid",
    });
    stream.abort();
    await stream.close();
    expect(closeCalls).toBe(1);
    expect(abortCalls).toBe(0);
  });

  test("keeps the async facade narrow and exposes response data explicitly", async () => {
    const stub = makeStubAt();
    const fake = makeFakeStreamingAnthropic([]);
    const stream = new AnthropicAdapter(
      fake.client,
      stub.at,
    ).messages.stream({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    });

    expect((stream as any).request_id).toBeUndefined();
    expect((stream as any).toReadableStream).toBeUndefined();
    const result = await stream.withResponse();
    expect(result.data).toBe(stream);
    expect(result.request_id).toBe("req_fake_stream");
    expect(result.response).toBe(fake.managed.response);
    expect((stream as any).request_id).toBeUndefined();
  });

  test("withResponse cannot return provider data after same-job cancellation", async () => {
    class ControlledWithResponseStream extends FakeManagedStream {
      private markWithResponseStarted!: () => void;
      private resolveWithResponse:
        | ((value: Record<string, unknown>) => void)
        | undefined;
      readonly withResponseStarted = new Promise<void>((resolve) => {
        this.markWithResponseStarted = resolve;
      });

      override withResponse(): Promise<Record<string, unknown>> {
        this.markWithResponseStarted();
        return new Promise((resolve) => {
          this.resolveWithResponse = resolve;
        });
      }

      resolveResponse(value: Record<string, unknown>): void {
        if (!this.resolveWithResponse) {
          throw new Error("withResponse() has not started");
        }
        this.resolveWithResponse(value);
      }
    }

    const provider = new ControlledWithResponseStream(
      [{ type: "message_start" }],
      {
        id: "msg_with_response_race",
        model: "claude-test",
        content: [{ type: "text", text: "never returned" }],
      },
    );
    const client = {
      messages: {
        create: async () => provider,
        stream: () => provider,
      },
    };
    const stream = new AnthropicAdapter(
      client,
      makeStubAt().at,
    ).messages.stream({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    });
    await stream[Symbol.asyncIterator]().next();

    const pendingResponse = stream.withResponse();
    await provider.withResponseStarted;
    provider.resolveResponse({
      data: provider,
      response: provider.response,
      request_id: provider.request_id,
    });
    const cancellation = new Error("cancelled after provider resolution");
    stream.controller.abort(cancellation);

    await expect(pendingResponse).rejects.toBe(cancellation);
    expect(provider.abortCount).toBe(1);
  });

  test("fences late control while releasing completed provider resources once", async () => {
    const abortFake = makeFakeStreamingAnthropic([
      { type: "message_start" },
    ]);
    const abortStream = new AnthropicAdapter(
      abortFake.client,
      makeStubAt().at,
    ).messages.stream({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    });
    const abortIterator = abortStream[Symbol.asyncIterator]();
    expect((await abortIterator.next()).done).toBe(false);

    await abortStream.finalMessage();
    expect(await abortIterator.next()).toEqual({
      value: undefined,
      done: true,
    });
    const lateError = new Error("late throw");
    await expect(abortIterator.throw!(lateError)).rejects.toBe(lateError);
    abortStream.abort();
    await abortStream.close();
    abortStream.abort();

    expect(abortStream.controller.signal.aborted).toBe(true);
    expect(abortFake.managed.abortCount).toBe(1);
    expect(abortFake.managed.closeCount).toBe(0);
    expect(abortFake.managed.returnCount).toBe(0);
    expect(abortFake.managed.throwCount).toBe(0);

    const closeFake = makeFakeStreamingAnthropic([]);
    const closeStream = new AnthropicAdapter(
      closeFake.client,
      makeStubAt().at,
    ).messages.stream({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    });
    await closeStream.finalMessage();
    await closeStream.close();
    await closeStream.close();
    closeStream.abort();
    expect(closeFake.managed.closeCount).toBe(1);
    expect(closeFake.managed.abortCount).toBe(0);

    const returnFake = makeFakeStreamingAnthropic([
      { type: "message_start" },
    ]);
    const returnStream = new AnthropicAdapter(
      returnFake.client,
      makeStubAt().at,
    ).messages.stream({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    });
    const returnIterator = returnStream[Symbol.asyncIterator]();
    await returnIterator.next();
    await returnStream.finalMessage();
    expect(await returnIterator.return!("late return")).toEqual({
      value: "late return",
      done: true,
    });
    returnStream.abort();
    await returnStream.close();
    expect(returnFake.managed.returnCount).toBe(1);
    expect(returnFake.managed.abortCount).toBe(0);
    expect(returnFake.managed.closeCount).toBe(0);

    const controllerFake = makeFakeStreamingAnthropic([]);
    const controllerStream = new AnthropicAdapter(
      controllerFake.client,
      makeStubAt().at,
    ).messages.stream({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    });
    const completed = await controllerStream.finalMessage();
    controllerStream.controller.abort(new Error("release after completion"));
    await Promise.resolve();
    expect(controllerFake.managed.abortCount).toBe(1);
    expect(await controllerStream.finalMessage()).toBe(completed);
    controllerStream.abort();
    await controllerStream.close();
    expect(controllerFake.managed.abortCount).toBe(1);
    expect(controllerFake.managed.closeCount).toBe(0);
  });

  test("late iterator throw preserves the first cancellation or failure", async () => {
    const cancelledFake = makeFakeStreamingAnthropic([
      { type: "message_start" },
    ]);
    const cancelledStream = new AnthropicAdapter(
      cancelledFake.client,
      makeStubAt().at,
    ).messages.stream({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    });
    const cancelledIterator = cancelledStream[Symbol.asyncIterator]();
    await cancelledIterator.next();
    const abortEvent = cancelledStream.emitted("abort");
    cancelledStream.abort();
    const cancellation = await abortEvent;
    await expect(
      cancelledIterator.throw!(new Error("late replacement")),
    ).rejects.toBe(cancellation);
    expect(cancelledFake.managed.throwCount).toBe(0);

    const failedFake = makeFakeStreamingAnthropic([
      { type: "message_start" },
    ]);
    const failedStream = new AnthropicAdapter(
      failedFake.client,
      makeStubAt().at,
    ).messages.stream({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    });
    const failedIterator = failedStream[Symbol.asyncIterator]();
    await failedIterator.next();
    const providerFailure = new Error("provider failed first");
    failedFake.managed.emit("error", providerFailure);
    await expect(
      failedIterator.throw!(new Error("late replacement")),
    ).rejects.toBe(providerFailure);
    expect(failedFake.managed.throwCount).toBe(0);
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

  test("rejects a confidence value with trailing non-numeric text", async () => {
    const stub = makeStubAt();
    const fake = makeFakeAnthropic(
      `<agenttool><trace type="decision" confidence="0.8junk"><decision>Use approach A</decision><conclusion>Performance is better</conclusion></trace></agenttool>`,
    );
    const adapter = new AnthropicAdapter(fake.client, stub.at);

    await adapter.messages.create({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "decide" }],
    });

    const body = stub.recorded[0].body as any;
    expect(body.reasoning.confidence).toBeUndefined();
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

  test("preserves mutable response identity, prototype, and method identity", async () => {
    class ProviderMessage {
      readonly id = "msg_class";
      readonly model = "claude-test";
      readonly content = [{ type: "text", text: "ok" }];

      marker(): string {
        return `${this.id}:${this.model}`;
      }
    }

    const response = new ProviderMessage();
    const client = {
      messages: {
        create: async () => response,
      },
    };
    const stub = makeStubAt();
    const adapter = new AnthropicAdapter(client as any, stub.at);
    const originalMethod = response.marker;

    const adapted = await adapter.messages.create({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
      metadata: {
        agenttool: {
          skip_wake: true,
          skip_markup: true,
        },
      },
    });

    expect(adapted).toBe(response);
    expect(adapted).toBeInstanceOf(ProviderMessage);
    expect((adapted as any).marker).toBe(originalMethod);
    expect((adapted as any).marker()).toBe("msg_class:claude-test");
    expect(
      Object.getOwnPropertyDescriptor(adapted, "agenttool")?.enumerable,
    ).toBe(false);
    expect(Object.keys(adapted)).not.toContain("agenttool");
  });

  test("falls back when a proxy swallows agenttool definition", async () => {
    const target = {
      id: "msg_swallowed_definition",
      model: "claude-test",
      content: [{ type: "text", text: "ok" }],
    };
    let defineCalls = 0;
    const response = new Proxy(target, {
      defineProperty() {
        defineCalls++;
        return true;
      },
    });
    const client = {
      messages: {
        create: async () => response,
      },
    };
    const adapted = await new AnthropicAdapter(
      client,
      makeStubAt().at,
    ).messages.create({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
      metadata: { agenttool: { skip_wake: true, skip_markup: true } },
    });

    expect(defineCalls).toBe(1);
    expect(adapted).not.toBe(response);
    expect("agenttool" in response).toBe(false);
    expect(adapted.id).toBe("msg_swallowed_definition");
    expect(adapted.agenttool.wake_used).toBe(false);
  });

  test("does not clobber a provider-native agenttool field", async () => {
    const providerField = { provider: "native" };
    const response = {
      id: "msg_provider_field",
      model: "claude-test",
      content: [{ type: "text", text: "ok" }],
      agenttool: providerField,
    };
    const client = {
      messages: {
        create: async () => response,
      },
    };
    const adapted = await new AnthropicAdapter(
      client,
      makeStubAt().at,
    ).messages.create({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
      metadata: { agenttool: { skip_wake: true, skip_markup: true } },
    });

    expect(adapted).not.toBe(response);
    expect(response.agenttool).toBe(providerField);
    expect(adapted.agenttool.wake_used).toBe(false);
  });

  test("keeps each receipt stable when a provider reuses one response", async () => {
    const response = {
      id: "msg_reused",
      model: "claude-test",
      content: [{ type: "text", text: "ok" }],
    };
    const client = {
      messages: {
        create: async () => response,
      },
    };
    const adapter = new AnthropicAdapter(client, makeStubAt().at);
    const params = {
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
      metadata: {
        agenttool: {
          trace: "decision" as const,
          skip_wake: true,
          skip_markup: true,
        },
      },
    };

    const first = await adapter.messages.create(params);
    const second = await adapter.messages.create(params);

    expect(first).toBe(response);
    expect(second).not.toBe(response);
    expect(first.agenttool.trace_id).toBe("tr_test_1");
    expect(second.agenttool.trace_id).toBe("tr_test_2");
    expect(first.agenttool.trace_id).toBe("tr_test_1");
  });

  test("uses a prototype-safe fallback for frozen responses", async () => {
    class FrozenProviderMessage {
      readonly id = "msg_frozen";
      readonly model = "claude-test";
      readonly content = [{ type: "text", text: "ok" }];
      readonly ownMarker = function (this: FrozenProviderMessage): string {
        return `${this.id}:own`;
      };

      marker(): string {
        return `${this.id}:${this.model}`;
      }
    }

    const response = Object.freeze(new FrozenProviderMessage());
    const client = {
      messages: {
        create: async () => response,
      },
    };
    const stub = makeStubAt();
    const adapted = await new AnthropicAdapter(
      client as any,
      stub.at,
    ).messages.create({
      model: "claude-test",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
      metadata: {
        agenttool: {
          skip_wake: true,
          skip_markup: true,
        },
      },
    });

    expect(adapted).not.toBe(response);
    expect(adapted).toBeInstanceOf(FrozenProviderMessage);
    expect((adapted as any).marker()).toBe("msg_frozen:claude-test");
    expect((adapted as any).ownMarker()).toBe("msg_frozen:own");
    expect(adapted.agenttool.wake_used).toBe(false);
    expect("agenttool" in adapted).toBe(true);
    expect(Object.keys(adapted)).not.toContain("agenttool");
    expect(Reflect.set(adapted, "extra", 2)).toBe(false);
    expect(Reflect.defineProperty(adapted, "id", {
      value: "poison",
      configurable: false,
    })).toBe(false);
    expect(Reflect.deleteProperty(adapted, "id")).toBe(false);
    expect(Reflect.setPrototypeOf(adapted, null)).toBe(false);
    expect(Reflect.preventExtensions(adapted)).toBe(false);
    expect(adapted.id).toBe("msg_frozen");
    expect(Object.getOwnPropertyDescriptor(adapted, "id")?.value).toBe(
      "msg_frozen",
    );
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
