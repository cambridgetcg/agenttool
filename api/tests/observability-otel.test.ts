/** Zero-dep OpenTelemetry GenAI span emitter — wire shape tests.
 *
 *  Pins:
 *    - withInvokeAgentSpan records the gen_ai.* attributes per CNCF semconv
 *    - withExecuteToolSpan records gen_ai.tool.* attributes
 *    - setTokenUsage adds input/output token attrs to the active span
 *    - span IDs are valid hex of correct length (16/32 chars)
 *    - timing is monotonic + duration is in nanoseconds
 *    - error in fn → status code 2 (ERROR) + exception event recorded
 *    - silent no-op when OTLP endpoint env unset (no throws)
 *
 *  Buffer enabled via AGENTTOOL_OTEL_TEST_BUFFER=1 set in this test file.
 *
 *  Doctrine: docs/ALIGNMENT-MOVES.md (Move 3) · docs/ECOSYSTEM.md.
 */

process.env.AGENTTOOL_OTEL_TEST_BUFFER = "1";

import { describe, expect, test, beforeEach } from "bun:test";

// Import AFTER the env var is set so the module reads it.
import {
  withInvokeAgentSpan,
  withExecuteToolSpan,
  withSpan,
  setTokenUsage,
  SpanKind,
  StatusCode,
  _testFlush,
} from "../src/observability/otel";

describe("OTel GenAI span emitter — zero-dep", () => {
  beforeEach(() => {
    _testFlush();
  });

  test("withInvokeAgentSpan records gen_ai.* attributes per CNCF semconv", async () => {
    await withInvokeAgentSpan(
      {
        agentId: "did:agenttool:abc123",
        agentName: "Sophia",
        agentVersion: "1.0",
        system: "anthropic",
        requestModel: "claude-opus-4-7",
      },
      async () => "result",
    );
    const spans = _testFlush();
    expect(spans).toHaveLength(1);
    const s = spans[0];
    expect(s.name).toBe("invoke_agent");
    expect(s.kind).toBe(SpanKind.CLIENT);
    expect(s.attributes["gen_ai.operation.name"]).toBe("invoke_agent");
    expect(s.attributes["gen_ai.agent.id"]).toBe("did:agenttool:abc123");
    expect(s.attributes["gen_ai.agent.name"]).toBe("Sophia");
    expect(s.attributes["gen_ai.agent.version"]).toBe("1.0");
    expect(s.attributes["gen_ai.system"]).toBe("anthropic");
    expect(s.attributes["gen_ai.request.model"]).toBe("claude-opus-4-7");
    expect(s.status.code).toBe(StatusCode.OK);
  });

  test("withExecuteToolSpan records gen_ai.tool.* attributes", async () => {
    await withExecuteToolSpan(
      {
        toolName: "bridge.encrypt",
        agentId: "did:agenttool:abc123",
        toolCallId: "call-42",
      },
      async () => ({}),
    );
    const [span] = _testFlush();
    expect(span.name).toBe("execute_tool");
    expect(span.kind).toBe(SpanKind.INTERNAL);
    expect(span.attributes["gen_ai.operation.name"]).toBe("execute_tool");
    expect(span.attributes["gen_ai.tool.name"]).toBe("bridge.encrypt");
    expect(span.attributes["gen_ai.tool.call.id"]).toBe("call-42");
    expect(span.attributes["gen_ai.agent.id"]).toBe("did:agenttool:abc123");
  });

  test("setTokenUsage adds usage attrs to active span", async () => {
    await withInvokeAgentSpan(
      {
        agentId: "did:agenttool:abc123",
        system: "openai",
        requestModel: "gpt-5",
      },
      async (span) => {
        setTokenUsage(span, {
          inputTokens: 1024,
          outputTokens: 512,
          responseModel: "gpt-5-2026-03-01",
          finishReason: "stop",
        });
      },
    );
    const [span] = _testFlush();
    expect(span.attributes["gen_ai.usage.input_tokens"]).toBe(1024);
    expect(span.attributes["gen_ai.usage.output_tokens"]).toBe(512);
    expect(span.attributes["gen_ai.response.model"]).toBe("gpt-5-2026-03-01");
    expect(span.attributes["gen_ai.response.finish_reasons"]).toBe("stop");
  });

  test("span IDs are valid hex of OTLP-required length", async () => {
    await withSpan("test_span", { test: true }, async () => {});
    const [span] = _testFlush();
    expect(span.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(span.spanId).toMatch(/^[0-9a-f]{16}$/);
  });

  test("timestamps are monotonic + duration is in nanoseconds", async () => {
    await withSpan("timed_span", {}, async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const [span] = _testFlush();
    const start = BigInt(span.startTimeUnixNano);
    const end = BigInt(span.endTimeUnixNano);
    expect(end > start).toBe(true);
    // Duration should be ≥ ~5ms (5_000_000 ns) accounting for jitter
    expect(end - start).toBeGreaterThan(5_000_000n);
  });

  test("error in fn → status ERROR + exception event recorded", async () => {
    let threw = false;
    try {
      await withSpan("failing_span", {}, async () => {
        throw new Error("boom");
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    const [span] = _testFlush();
    expect(span.status.code).toBe(StatusCode.ERROR);
    expect(span.status.message).toBe("boom");
    expect(span.events).toHaveLength(1);
    expect(span.events![0].name).toBe("exception");
    expect(span.events![0].attributes!["exception.message"]).toBe("boom");
    expect(span.events![0].attributes!["exception.type"]).toBe("Error");
  });

  test("undefined/null attributes are omitted (no spurious keys)", async () => {
    await withInvokeAgentSpan(
      {
        agentId: "did:agenttool:nondescript",
        system: "anthropic",
        requestModel: "claude-haiku-4-5",
        // agentName + agentVersion left undefined
      },
      async () => {},
    );
    const [span] = _testFlush();
    expect(span.attributes["gen_ai.agent.id"]).toBe("did:agenttool:nondescript");
    expect("gen_ai.agent.name" in span.attributes).toBe(false);
    expect("gen_ai.agent.version" in span.attributes).toBe(false);
  });

  test("nested spans share traceId when parent is passed", async () => {
    let outerTraceId = "";
    let outerSpanId = "";
    await withSpan("outer", {}, async () => {
      const [first] = _testFlush(); // no, outer hasn't emitted yet
      // Capture from a follow-up assertion after outer ends
    });
    const [outer] = _testFlush();
    outerTraceId = outer.traceId;
    outerSpanId = outer.spanId;
    expect(outerTraceId).toMatch(/^[0-9a-f]{32}$/);

    await withSpan("inner", {}, async () => {}, {
      parent: { traceId: outerTraceId, spanId: outerSpanId },
    });
    const [inner] = _testFlush();
    expect(inner.traceId).toBe(outerTraceId);
    expect(inner.parentSpanId).toBe(outerSpanId);
    expect(inner.spanId).not.toBe(outerSpanId);
  });

  test("silent no-op when OTLP endpoint is unset (no throw)", async () => {
    // Endpoint unset (test env doesn't configure it). Run a span; should
    // not throw, and the test buffer still receives the record for
    // local visibility.
    delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
    const result = await withInvokeAgentSpan(
      {
        agentId: "did:agenttool:silent",
        system: "anthropic",
        requestModel: "claude-opus-4-7",
      },
      async () => 42,
    );
    expect(result).toBe(42);
    const [span] = _testFlush();
    expect(span.attributes["gen_ai.agent.id"]).toBe("did:agenttool:silent");
  });
});
