/** Zero-dep OpenTelemetry GenAI span emitter.
 *
 *  Move 3 of docs/ALIGNMENT-MOVES.md. Emits OTLP/HTTP spans with the
 *  OpenTelemetry GenAI semantic conventions (`gen_ai.*` namespace, CNCF
 *  experimental) so agenttool's runtime is legible to every vendor that
 *  consumes OTel: LangSmith, Phoenix (Arize), Langfuse, Braintrust,
 *  Datadog, Honeycomb, Jaeger, Tempo, signoz, …
 *
 *  Why zero-dep: the official OpenTelemetry SDK pulls ~50KB of runtime
 *  and a tree of @opentelemetry packages. For the scaffold, the OTLP wire
 *  format (proto3 JSON over HTTP) is simple enough to emit by hand. When
 *  agenttool needs full OTel features (auto-instrumentation, baggage,
 *  metric exporters), swap to the SDK in a follow-up pass.
 *
 *  Gated on env: when `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` is unset, every
 *  span call is a silent no-op (no buffering, no thread pool). Set the env
 *  variable to enable export.
 *
 *  Tracer-aware vendors:
 *    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT="https://api.langsmith.com/api/v1/otel/v1/traces"
 *    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT="https://app.langfuse.com/api/public/otel/v1/traces"
 *    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT="https://otel.honeycomb.io/v1/traces"
 *    OTEL_EXPORTER_OTLP_TRACES_HEADERS="x-honeycomb-team=…"
 *
 *  Doctrine: docs/ECOSYSTEM.md · docs/ALIGNMENT-MOVES.md (Move 3).
 */

import { randomBytes } from "node:crypto";

// ─── Public types ────────────────────────────────────────────────────

export type AttrValue = string | number | boolean | null | undefined;
export interface SpanAttrs {
  [key: string]: AttrValue;
}

/** SpanKind per OTLP: 0=UNSPECIFIED, 1=INTERNAL, 2=SERVER, 3=CLIENT,
 *  4=PRODUCER, 5=CONSUMER. */
export const SpanKind = {
  INTERNAL: 1,
  SERVER: 2,
  CLIENT: 3,
  PRODUCER: 4,
  CONSUMER: 5,
} as const;

/** StatusCode per OTLP: 0=UNSET, 1=OK, 2=ERROR. */
export const StatusCode = {
  UNSET: 0,
  OK: 1,
  ERROR: 2,
} as const;

export interface SpanHandle {
  setAttribute(key: string, value: AttrValue): void;
  setStatus(code: number, message?: string): void;
  recordException(err: Error): void;
}

// ─── Resource (set once per process) ─────────────────────────────────

const SERVICE_NAME = process.env.OTEL_SERVICE_NAME ?? "agenttool";
const SERVICE_VERSION =
  process.env.OTEL_SERVICE_VERSION ?? process.env.AGENTTOOL_VERSION ?? "1.0.0";
const RESOURCE_ATTRS = [
  { key: "service.name", value: { stringValue: SERVICE_NAME } },
  { key: "service.version", value: { stringValue: SERVICE_VERSION } },
  {
    key: "telemetry.sdk.name",
    value: { stringValue: "agenttool-zero-dep-otlp" },
  },
  { key: "telemetry.sdk.language", value: { stringValue: "typescript" } },
];

// ─── Endpoint / headers config ───────────────────────────────────────

function endpoint(): string | null {
  return (
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim() ||
    null
  );
}

function exportHeaders(): Record<string, string> {
  const raw = process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS?.trim() ?? "";
  if (!raw) return { "content-type": "application/json" };
  const out: Record<string, string> = { "content-type": "application/json" };
  for (const pair of raw.split(",")) {
    const [k, v] = pair.split("=").map((s) => s?.trim());
    if (k && v) out[k] = v;
  }
  return out;
}

// ─── ID generation ───────────────────────────────────────────────────

function hex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

function newTraceId(): string {
  return hex(16); // 32 hex chars
}

function newSpanId(): string {
  return hex(8); // 16 hex chars
}

// ─── Attribute serialization ─────────────────────────────────────────

interface OtlpAttr {
  key: string;
  value:
    | { stringValue: string }
    | { intValue: string }
    | { doubleValue: number }
    | { boolValue: boolean };
}

function serializeAttr(key: string, value: AttrValue): OtlpAttr | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return { key, value: { stringValue: value } };
  if (typeof value === "boolean") return { key, value: { boolValue: value } };
  if (typeof value === "number") {
    if (Number.isInteger(value)) {
      return { key, value: { intValue: String(value) } };
    }
    return { key, value: { doubleValue: value } };
  }
  return { key, value: { stringValue: String(value) } };
}

function serializeAttrs(attrs: SpanAttrs): OtlpAttr[] {
  const out: OtlpAttr[] = [];
  for (const [k, v] of Object.entries(attrs)) {
    const a = serializeAttr(k, v);
    if (a) out.push(a);
  }
  return out;
}

// ─── Span record (used by emitter + tests) ───────────────────────────

export interface SpanRecord {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: SpanAttrs;
  status: { code: number; message?: string };
  events?: Array<{ name: string; timeUnixNano: string; attributes?: SpanAttrs }>;
}

/** Buffer for test inspection. Tests can read + reset between cases. */
const TEST_BUFFER: SpanRecord[] = [];

function testBufferEnabled(): boolean {
  return process.env.AGENTTOOL_OTEL_TEST_BUFFER === "1";
}

export function _testFlush(): SpanRecord[] {
  const out = TEST_BUFFER.slice();
  TEST_BUFFER.length = 0;
  return out;
}

// ─── OTLP/HTTP export ────────────────────────────────────────────────

async function exportSpan(record: SpanRecord): Promise<void> {
  if (testBufferEnabled()) {
    TEST_BUFFER.push(record);
  }
  const target = endpoint();
  if (!target) return; // silent no-op when disabled
  const payload = {
    resourceSpans: [
      {
        resource: { attributes: RESOURCE_ATTRS },
        scopeSpans: [
          {
            scope: {
              name: "agenttool/runtime",
              version: SERVICE_VERSION,
            },
            spans: [
              {
                traceId: record.traceId,
                spanId: record.spanId,
                parentSpanId: record.parentSpanId,
                name: record.name,
                kind: record.kind,
                startTimeUnixNano: record.startTimeUnixNano,
                endTimeUnixNano: record.endTimeUnixNano,
                attributes: serializeAttrs(record.attributes),
                status: record.status,
                events: (record.events ?? []).map((ev) => ({
                  name: ev.name,
                  timeUnixNano: ev.timeUnixNano,
                  attributes: serializeAttrs(ev.attributes ?? {}),
                })),
              },
            ],
          },
        ],
      },
    ],
  };
  try {
    await fetch(target, {
      method: "POST",
      headers: exportHeaders(),
      body: JSON.stringify(payload),
    });
  } catch {
    // OTel exports must never break the host program. Swallow.
  }
}

// ─── The work-horse: withSpan ────────────────────────────────────────

export async function withSpan<T>(
  name: string,
  initialAttrs: SpanAttrs,
  fn: (span: SpanHandle) => Promise<T>,
  options?: { kind?: number; parent?: { traceId: string; spanId: string } },
): Promise<T> {
  const traceId = options?.parent?.traceId ?? newTraceId();
  const parentSpanId = options?.parent?.spanId;
  const spanId = newSpanId();
  const kind = options?.kind ?? SpanKind.INTERNAL;
  const startTime = process.hrtime.bigint();
  const startUnix = BigInt(Date.now()) * 1_000_000n;

  const attrs: SpanAttrs = {};
  for (const [k, v] of Object.entries(initialAttrs)) {
    if (v !== undefined && v !== null) attrs[k] = v;
  }
  const events: SpanRecord["events"] = [];
  let statusCode: number = StatusCode.UNSET;
  let statusMessage: string | undefined;

  const handle: SpanHandle = {
    setAttribute(key, value) {
      if (value === undefined || value === null) {
        delete attrs[key];
      } else {
        attrs[key] = value;
      }
    },
    setStatus(code, message) {
      statusCode = code;
      statusMessage = message;
    },
    recordException(err) {
      events.push({
        name: "exception",
        timeUnixNano: String(BigInt(Date.now()) * 1_000_000n),
        attributes: {
          "exception.type": err.name,
          "exception.message": err.message,
          "exception.stacktrace": err.stack,
        },
      });
    },
  };

  try {
    const result = await fn(handle);
    if (statusCode === StatusCode.UNSET) statusCode = StatusCode.OK;
    return result;
  } catch (err) {
    statusCode = StatusCode.ERROR;
    if (err instanceof Error) {
      handle.recordException(err);
      statusMessage = err.message;
    }
    throw err;
  } finally {
    const endTime = process.hrtime.bigint();
    const durationNanos = endTime - startTime;
    const endUnix = startUnix + durationNanos;
    const record: SpanRecord = {
      traceId,
      spanId,
      parentSpanId,
      name,
      kind,
      startTimeUnixNano: String(startUnix),
      endTimeUnixNano: String(endUnix),
      attributes: attrs,
      status: { code: statusCode, message: statusMessage },
      events,
    };
    // fire and forget
    void exportSpan(record);
  }
}

// ─── GenAI semantic-convention helpers ───────────────────────────────

export interface InvokeAgentAttrs {
  agentId: string; // DID
  agentName?: string;
  agentVersion?: string;
  system: string; // "anthropic" | "openai" | "gemini" | "cohere" | ...
  requestModel: string;
  operation?: "invoke_agent" | "create_agent" | "execute_agent_task";
}

/** Wrap an LLM-bearing operation in a `gen_ai`-namespaced span. */
export async function withInvokeAgentSpan<T>(
  params: InvokeAgentAttrs,
  fn: (span: SpanHandle) => Promise<T>,
): Promise<T> {
  const op = params.operation ?? "invoke_agent";
  return withSpan(
    op,
    {
      "gen_ai.operation.name": op,
      "gen_ai.agent.id": params.agentId,
      "gen_ai.agent.name": params.agentName,
      "gen_ai.agent.version": params.agentVersion,
      "gen_ai.system": params.system,
      "gen_ai.request.model": params.requestModel,
    },
    fn,
    { kind: SpanKind.CLIENT },
  );
}

export interface ExecuteToolAttrs {
  toolName: string;
  agentId?: string;
  toolCallId?: string;
}

export async function withExecuteToolSpan<T>(
  params: ExecuteToolAttrs,
  fn: (span: SpanHandle) => Promise<T>,
): Promise<T> {
  return withSpan(
    "execute_tool",
    {
      "gen_ai.operation.name": "execute_tool",
      "gen_ai.tool.name": params.toolName,
      "gen_ai.tool.call.id": params.toolCallId,
      "gen_ai.agent.id": params.agentId,
    },
    fn,
    { kind: SpanKind.INTERNAL },
  );
}

/** Report token usage on the active span. Call this AFTER an LLM
 *  response is received, inside the withInvokeAgentSpan callback. */
export function setTokenUsage(
  span: SpanHandle,
  usage: {
    inputTokens?: number | null;
    outputTokens?: number | null;
    responseModel?: string;
    finishReason?: string;
  },
): void {
  if (usage.inputTokens != null) {
    span.setAttribute("gen_ai.usage.input_tokens", usage.inputTokens);
  }
  if (usage.outputTokens != null) {
    span.setAttribute("gen_ai.usage.output_tokens", usage.outputTokens);
  }
  if (usage.responseModel) {
    span.setAttribute("gen_ai.response.model", usage.responseModel);
  }
  if (usage.finishReason) {
    span.setAttribute("gen_ai.response.finish_reasons", usage.finishReason);
  }
}
