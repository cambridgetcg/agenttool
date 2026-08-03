import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { describe, expect, test } from "bun:test";

import { AnthropicAdapter } from "../src/anthropic-adapter";
import { ChronicleClient } from "../src/chronicle";
import type { AgentTool } from "../src/client";
import { AgentToolError } from "../src/errors";
import { OpenAIResponsesAdapter } from "../src/openai-responses-adapter";

type JsonPrimitive = boolean | number | string | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

interface TranscriptEvent {
  boundary: string;
  operation: string;
  payload: JsonObject;
}

interface EvidenceCase {
  id: string;
  provider: "openai" | "anthropic";
  lifecycle: string;
  fixture: string;
  proves: string[];
  expectedTranscript: TranscriptEvent[];
}

const REPOSITORY_ROOT = resolve(import.meta.dir, "../../..");
const EVIDENCE_PATH = resolve(
  REPOSITORY_ROOT,
  "review/provider-adapters/v1/evidence.json",
);

const VOCABULARY = {
  providers: ["openai", "anthropic"],
  languages: ["typescript", "python"],
  lifecycles: [
    "completed",
    "low-level-stream",
    "managed-stream",
    "refused",
  ],
  boundaries: [
    "agenttool.wake",
    "agenttool.write",
    "provider.openai.responses",
    "provider.anthropic.messages",
    "provider.anthropic.stream",
    "adapter",
  ],
  operations: [
    "system",
    "create",
    "stream",
    "final-message",
    "abort",
    "result",
    "refuse",
  ],
  dataClasses: [
    "wake-text",
    "caller-instructions",
    "caller-prompt",
    "provider-metadata",
    "provider-response",
    "provider-stream-event",
    "prompt-excerpt",
    "response-excerpt",
    "parsed-chronicle",
    "parsed-trace",
    "local-receipt",
  ],
  flowEndpoints: [
    "provider-client",
    "agenttool-wake",
    "agenttool-traces",
    "agenttool-chronicle",
    "caller-process",
    "adapter-process",
  ],
  controlKinds: ["enforced-local", "requested-upstream"],
} as const;

const SOURCE_BINDINGS = {
  "openai-typescript": {
    provider: "openai",
    language: "typescript",
    path: "packages/sdk-ts/src/openai-responses-adapter.ts",
  },
  "openai-python": {
    provider: "openai",
    language: "python",
    path: "packages/sdk-py/src/agenttool/openai_responses_adapter.py",
  },
  "anthropic-typescript": {
    provider: "anthropic",
    language: "typescript",
    path: "packages/sdk-ts/src/anthropic-adapter.ts",
  },
  "anthropic-python": {
    provider: "anthropic",
    language: "python",
    path: "packages/sdk-py/src/agenttool/anthropic_adapter.py",
  },
} as const;

const FLOW_IDS = [
  "wake-to-provider",
  "caller-request-to-provider",
  "provider-response-to-caller",
  "provider-stream-event-to-caller",
  "local-receipt-to-caller",
  "opt-in-trace-to-agenttool",
  "anthropic-chronicle-markup-to-agenttool",
  "anthropic-trace-markup-to-agenttool",
] as const;

const CONTROL_IDS = [
  "local-agenttool-metadata-stripped",
  "openai-omitted-store-false",
  "openai-explicit-store-preserved",
  "openai-stream-background-refused",
  "anthropic-wake-block-order",
  "anthropic-ephemeral-cache-request",
  "anthropic-low-level-no-final-effects",
  "anthropic-managed-terminal-fence",
  "anthropic-model-authored-chronicle-gated",
] as const;

const CASE_BINDINGS = {
  "openai-completed-default-store-trace": {
    provider: "openai",
    lifecycle: "completed",
    fixture: "openai.completed.default-store-trace",
    proves: [
      "local-agenttool-metadata-stripped",
      "openai-omitted-store-false",
    ],
  },
  "openai-completed-explicit-store-skip-wake": {
    provider: "openai",
    lifecycle: "completed",
    fixture: "openai.completed.explicit-store-skip-wake",
    proves: [
      "local-agenttool-metadata-stripped",
      "openai-explicit-store-preserved",
    ],
  },
  "openai-stream-refused-before-io": {
    provider: "openai",
    lifecycle: "refused",
    fixture: "openai.refused.stream",
    proves: ["openai-stream-background-refused"],
  },
  "openai-background-refused-before-io": {
    provider: "openai",
    lifecycle: "refused",
    fixture: "openai.refused.background",
    proves: ["openai-stream-background-refused"],
  },
  "anthropic-completed-trace-and-markup": {
    provider: "anthropic",
    lifecycle: "completed",
    fixture: "anthropic.completed.trace-and-markup",
    proves: [
      "local-agenttool-metadata-stripped",
      "anthropic-wake-block-order",
      "anthropic-ephemeral-cache-request",
    ],
  },
  "anthropic-low-level-no-final-effects": {
    provider: "anthropic",
    lifecycle: "low-level-stream",
    fixture: "anthropic.low-level.no-final-effects",
    proves: [
      "local-agenttool-metadata-stripped",
      "anthropic-low-level-no-final-effects",
    ],
  },
  "anthropic-low-level-trace-refused-before-io": {
    provider: "anthropic",
    lifecycle: "refused",
    fixture: "anthropic.low-level.trace-refused",
    proves: ["anthropic-low-level-no-final-effects"],
  },
  "anthropic-managed-completed-exact-once": {
    provider: "anthropic",
    lifecycle: "managed-stream",
    fixture: "anthropic.managed.completed-exact-once",
    proves: [
      "local-agenttool-metadata-stripped",
      "anthropic-managed-terminal-fence",
    ],
  },
  "anthropic-managed-cancelled-no-effects": {
    provider: "anthropic",
    lifecycle: "managed-stream",
    fixture: "anthropic.managed.cancelled-no-effects",
    proves: [
      "local-agenttool-metadata-stripped",
      "anthropic-managed-terminal-fence",
    ],
  },
} as const;

const CREDENTIAL_SHAPE =
  /(?:\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}|\bAKIA[0-9A-Z]{16}\b|\b(?:ghp|github_pat|xox[baprs])_[A-Za-z0-9_-]{12,})/i;
const CREDENTIAL_KEY_NAMES = new Set([
  "authorization",
  "token",
  "secret",
  "password",
]);
const CREDENTIAL_KEY_SUFFIXES = [
  "apikey",
  "accesstoken",
  "authtoken",
  "apitoken",
  "bearertoken",
  "clientsecret",
  "privatekey",
  "secretkey",
  "secretaccesskey",
  "sessiontoken",
  "accesstoken",
  "refreshtoken",
  "accesskeyid",
  "signingkey",
];

function object(value: unknown, label: string): Record<string, unknown> {
  expect(
    value !== null
      && typeof value === "object"
      && !Array.isArray(value)
      && Object.getPrototypeOf(value) === Object.prototype,
    `${label} must be a plain object`,
  ).toBe(true);
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  expect(Array.isArray(value), `${label} must be an array`).toBe(true);
  return value as unknown[];
}

function text(value: unknown, label: string): string {
  expect(typeof value === "string" && value.length > 0, `${label} must be non-empty text`)
    .toBe(true);
  return value as string;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  expect(Object.keys(value).sort(), `${label} fields are not closed`).toEqual(
    [...expected].sort(),
  );
}

function unique(values: unknown[], label: string): void {
  const canonical = values.map((value) => JSON.stringify(value));
  expect(new Set(canonical).size, `${label} must be unique`).toBe(
    canonical.length,
  );
}

function closedArray(
  value: unknown,
  allowed: readonly string[],
  label: string,
  minimum = 1,
): string[] {
  const values = array(value, label);
  expect(values.length, `${label} is too short`).toBeGreaterThanOrEqual(minimum);
  for (const item of values) {
    expect(
      typeof item === "string" && allowed.includes(item),
      `${label} is outside the closed vocabulary`,
    ).toBe(true);
  }
  unique(values, label);
  return values as string[];
}

function assertNoCredentialShapedValue(
  value: unknown,
  label = "fixture",
): void {
  if (typeof value === "string") {
    expect(value, `${label} contains credential-shaped text`).not.toMatch(
      CREDENTIAL_SHAPE,
    );
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertNoCredentialShapedValue(item, `${label}[${index}]`)
    );
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      const shaped = CREDENTIAL_KEY_NAMES.has(normalizedKey)
        || CREDENTIAL_KEY_SUFFIXES.some((suffix) =>
          normalizedKey.endsWith(suffix)
        );
      expect(shaped, `${label} contains credential-shaped key ${key}`).toBe(
        false,
      );
      assertNoCredentialShapedValue(item, `${label}.${key}`);
    }
  }
}

function readSource(relativePath: string): Uint8Array {
  expect(isAbsolute(relativePath)).toBe(false);
  expect(relativePath.split("/")).not.toContain("..");
  const absolute = resolve(REPOSITORY_ROOT, relativePath);
  const inside = relative(REPOSITORY_ROOT, absolute);
  expect(
    inside !== ""
      && inside !== ".."
      && !inside.startsWith(`..${sep}`)
      && !isAbsolute(inside),
  ).toBe(true);
  return readFileSync(absolute);
}

function validatePacket(packetValue: unknown): EvidenceCase[] {
  const packet = object(packetValue, "evidence packet");
  exactKeys(
    packet,
    [
      "$schema",
      "format",
      "asOf",
      "repository",
      "sources",
      "vocabulary",
      "normalization",
      "flows",
      "controls",
      "cases",
      "proofLimits",
    ],
    "evidence packet",
  );
  expect(packet.$schema).toBe("./evidence.schema.json");
  expect(packet.format).toBe("agenttool-provider-adapter-evidence/v1");
  expect(packet.asOf).toBe("2026-08-03");

  const repository = object(packet.repository, "repository");
  exactKeys(repository, ["url", "commit", "digestAlgorithm"], "repository");
  expect(repository).toEqual({
    url: "https://github.com/cambridgetcg/agenttool",
    commit: "bba2e83af5c1ab54562f7e87545ccb361c3507ab",
    digestAlgorithm: "sha256",
  });

  const sources = array(packet.sources, "sources");
  expect(sources).toHaveLength(Object.keys(SOURCE_BINDINGS).length);
  const sourceIds: string[] = [];
  for (const [index, sourceValue] of sources.entries()) {
    const label = `sources[${index}]`;
    const source = object(sourceValue, label);
    exactKeys(source, ["id", "provider", "language", "path", "sha256"], label);
    const sourceId = text(source.id, `${label}.id`);
    expect(sourceId in SOURCE_BINDINGS).toBe(true);
    const binding = SOURCE_BINDINGS[sourceId as keyof typeof SOURCE_BINDINGS];
    expect({
      provider: source.provider,
      language: source.language,
      path: source.path,
    }).toEqual(binding);
    const digest = text(source.sha256, `${label}.sha256`);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(createHash("sha256").update(readSource(binding.path)).digest("hex"))
      .toBe(digest);
    sourceIds.push(sourceId);
  }
  expect([...sourceIds].sort()).toEqual(Object.keys(SOURCE_BINDINGS).sort());
  unique(sourceIds, "source ids");

  const vocabulary = object(packet.vocabulary, "vocabulary");
  exactKeys(vocabulary, Object.keys(VOCABULARY), "vocabulary");
  expect(vocabulary).toEqual(VOCABULARY);

  const normalization = object(packet.normalization, "normalization");
  exactKeys(
    normalization,
    [
      "fieldNames",
      "omittedIdentityId",
      "omittedWakeProfile",
      "payloadRule",
      "resultRule",
    ],
    "normalization",
  );
  expect(normalization.fieldNames).toBe("camelCase");
  expect(normalization.omittedIdentityId).toBeNull();
  expect(normalization.omittedWakeProfile).toBe("full");
  text(normalization.payloadRule, "normalization.payloadRule");
  text(normalization.resultRule, "normalization.resultRule");

  const flows = array(packet.flows, "flows");
  expect(flows).toHaveLength(FLOW_IDS.length);
  const flowIds: string[] = [];
  for (const [index, flowValue] of flows.entries()) {
    const label = `flows[${index}]`;
    const flow = object(flowValue, label);
    exactKeys(
      flow,
      [
        "id",
        "providers",
        "lifecycles",
        "when",
        "dataClasses",
        "source",
        "destination",
      ],
      label,
    );
    const flowId = text(flow.id, `${label}.id`);
    expect(FLOW_IDS).toContain(flowId);
    closedArray(flow.providers, VOCABULARY.providers, `${label}.providers`);
    closedArray(
      flow.lifecycles,
      VOCABULARY.lifecycles,
      `${label}.lifecycles`,
    );
    text(flow.when, `${label}.when`);
    closedArray(
      flow.dataClasses,
      VOCABULARY.dataClasses,
      `${label}.dataClasses`,
    );
    expect(VOCABULARY.flowEndpoints).toContain(flow.source);
    expect(VOCABULARY.flowEndpoints).toContain(flow.destination);
    flowIds.push(flowId);
  }
  expect([...flowIds].sort()).toEqual([...FLOW_IDS].sort());
  unique(flowIds, "flow ids");

  const controls = array(packet.controls, "controls");
  expect(controls).toHaveLength(CONTROL_IDS.length);
  const controlIds: string[] = [];
  for (const [index, controlValue] of controls.entries()) {
    const label = `controls[${index}]`;
    const control = object(controlValue, label);
    exactKeys(control, ["id", "providers", "kind", "statement"], label);
    const controlId = text(control.id, `${label}.id`);
    expect(CONTROL_IDS).toContain(controlId);
    closedArray(
      control.providers,
      VOCABULARY.providers,
      `${label}.providers`,
    );
    expect(VOCABULARY.controlKinds).toContain(control.kind);
    text(control.statement, `${label}.statement`);
    controlIds.push(controlId);
  }
  expect([...controlIds].sort()).toEqual([...CONTROL_IDS].sort());
  unique(controlIds, "control ids");

  const cases = array(packet.cases, "cases");
  expect(cases).toHaveLength(Object.keys(CASE_BINDINGS).length);
  const caseIds: string[] = [];
  const validated: EvidenceCase[] = [];
  for (const [index, caseValue] of cases.entries()) {
    const label = `cases[${index}]`;
    const reviewCase = object(caseValue, label);
    exactKeys(
      reviewCase,
      [
        "id",
        "provider",
        "lifecycle",
        "fixture",
        "proves",
        "expectedTranscript",
      ],
      label,
    );
    const caseId = text(reviewCase.id, `${label}.id`);
    expect(caseId in CASE_BINDINGS).toBe(true);
    const binding = CASE_BINDINGS[caseId as keyof typeof CASE_BINDINGS];
    expect({
      provider: reviewCase.provider,
      lifecycle: reviewCase.lifecycle,
      fixture: reviewCase.fixture,
      proves: reviewCase.proves,
    }).toEqual(binding);

    const transcriptValues = array(
      reviewCase.expectedTranscript,
      `${label}.expectedTranscript`,
    );
    expect(transcriptValues.length).toBeGreaterThan(0);
    const transcript: TranscriptEvent[] = [];
    for (const [eventIndex, eventValue] of transcriptValues.entries()) {
      const eventLabel = `${label}.expectedTranscript[${eventIndex}]`;
      const event = object(eventValue, eventLabel);
      exactKeys(event, ["boundary", "operation", "payload"], eventLabel);
      expect(VOCABULARY.boundaries).toContain(event.boundary);
      expect(VOCABULARY.operations).toContain(event.operation);
      transcript.push({
        boundary: text(event.boundary, `${eventLabel}.boundary`),
        operation: text(event.operation, `${eventLabel}.operation`),
        payload: object(event.payload, `${eventLabel}.payload`) as JsonObject,
      });
    }
    caseIds.push(caseId);
    validated.push({
      id: caseId,
      provider: reviewCase.provider as EvidenceCase["provider"],
      lifecycle: text(reviewCase.lifecycle, `${label}.lifecycle`),
      fixture: text(reviewCase.fixture, `${label}.fixture`),
      proves: array(reviewCase.proves, `${label}.proves`) as string[],
      expectedTranscript: transcript,
    });
  }
  expect([...caseIds].sort()).toEqual(Object.keys(CASE_BINDINGS).sort());
  unique(caseIds, "case ids");

  const proofLimits = array(packet.proofLimits, "proofLimits");
  expect(proofLimits).toHaveLength(6);
  proofLimits.forEach((statement, index) =>
    text(statement, `proofLimits[${index}]`)
  );
  unique(proofLimits, "proofLimits");
  return validated;
}

function copyJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

class Recorder {
  readonly events: TranscriptEvent[] = [];
  wakeCalls = 0;
  providerCalls = 0;
  agenttoolWrites = 0;
  finalMessageCalls = 0;
  abortCalls = 0;

  add(boundary: string, operation: string, payload: JsonObject): void {
    this.events.push({ boundary, operation, payload: copyJson(payload) });
  }
}

/** Origin the offline chronicle client is pointed at. No request leaves\n *  the process: the transport below is the recorder. */
const CHRONICLE_ORIGIN = "https://review.invalid";

function makeRecordingAgentTool(recorder: Recorder): AgentTool {
  let traceCount = 0;
  let chronicleCount = 0;
  const at = {
    wake: {
      system: async (
        provider: string,
        options?: { identityId?: string; profile?: "full" | "brief" },
      ) => {
        recorder.wakeCalls++;
        recorder.add("agenttool.wake", "system", {
          provider,
          identityId: options?.identityId ?? null,
          profile: options?.profile ?? "full",
        });
        if (provider === "openai") {
          return {
            messages: [
              { role: "system", content: "OPENAI_STABLE_WAKE" },
              { role: "system", content: "OPENAI_VOLATILE_WAKE" },
            ],
            _meta: {
              provider,
              cache_eligible: "review-fixture",
              cache_note: "offline fixture",
            },
          };
        }
        return {
          system: [
            {
              type: "text",
              text: "ANTHROPIC_STABLE_WAKE",
              cache_control: { type: "ephemeral" },
            },
            { type: "text", text: "ANTHROPIC_VOLATILE_WAKE" },
          ],
          _meta: {
            provider,
            cache_eligible: "review-fixture",
            cache_note: "offline fixture",
          },
        };
      },
    },
    request: async (method: string, path: string, body: unknown) => {
      recorder.agenttoolWrites++;
      recorder.add("agenttool.write", "create", {
        method,
        path,
        body: body as JsonValue,
      });
      if (path === "/v1/traces") {
        traceCount++;
        return { trace_id: `tr_review_${traceCount}` };
      }
      if (path === "/v1/chronicle") {
        chronicleCount++;
        return { entry: { id: `ch_review_${chronicleCount}` } };
      }
      return {};
    },
    // The adapter routes model-authored chronicle writes through the real
    // ChronicleClient — that is where the canonical type union and the
    // 1-200 title bound are enforced — so the recorder is reached through
    // it rather than around it. Every write still lands in `request`.
    chronicle: new ChronicleClient({
      baseUrl: CHRONICLE_ORIGIN,
      headers: {},
      timeout: 5000,
      request: async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input).slice(CHRONICLE_ORIGIN.length);
        const body = init?.body ? JSON.parse(init.body as string) : undefined;
        const result = await at.request(init?.method ?? "GET", path, body);
        return new Response(JSON.stringify(result), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      },
    }),
  };
  return at as unknown as AgentTool;
}

function makeRecordingOpenAI(recorder: Recorder) {
  return {
    responses: {
      create: async (params: Record<string, unknown>) => {
        recorder.providerCalls++;
        recorder.add(
          "provider.openai.responses",
          "create",
          params as JsonObject,
        );
        return {
          id: "resp_review_fixture",
          status: "completed",
          output_text: "Bridge accepted.",
          output: [],
        };
      },
    },
  };
}

class LowLevelStream implements AsyncIterable<unknown> {
  closeCalls = 0;
  private consumed = false;

  [Symbol.asyncIterator](): AsyncIterator<unknown> {
    return {
      next: async () => {
        if (this.consumed) return { value: undefined, done: true };
        this.consumed = true;
        return { value: "delta", done: false };
      },
    };
  }

  close(): void {
    this.closeCalls++;
  }
}

type Listener = (...args: unknown[]) => void;

class ManagedProviderStream implements AsyncIterable<unknown> {
  readonly controller = new AbortController();
  finalMessageCalls = 0;
  abortCalls = 0;
  closeCalls = 0;
  private readonly listeners = new Map<
    string,
    Array<{ listener: Listener; once: boolean }>
  >();

  constructor(private readonly recorder: Recorder) {}

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

  emit(event: string, ...args: unknown[]): void {
    const listeners = this.listeners.get(event) ?? [];
    this.listeners.set(
      event,
      listeners.filter((entry) => !entry.once),
    );
    for (const entry of listeners) entry.listener(...args);
  }

  async finalMessage(): Promise<Record<string, unknown>> {
    this.finalMessageCalls++;
    this.recorder.finalMessageCalls++;
    this.recorder.add("provider.anthropic.stream", "final-message", {
      call: this.recorder.finalMessageCalls,
    });
    return this.completedMessage();
  }

  async withResponse(): Promise<Record<string, unknown>> {
    return {
      data: this,
      response: { status: 200 },
      request_id: "req_review_fixture",
    };
  }

  abort(): void {
    this.abortCalls++;
    this.recorder.abortCalls++;
    this.recorder.add("provider.anthropic.stream", "abort", {
      call: this.recorder.abortCalls,
    });
    if (!this.controller.signal.aborted) this.controller.abort();
  }

  close(): void {
    this.closeCalls++;
  }

  completedMessage(): Record<string, unknown> {
    return {
      id: "msg_review_managed",
      model: "claude-review-fixture",
      content: [{ type: "text", text: "Managed complete." }],
      stop_reason: "end_turn",
    };
  }

  [Symbol.asyncIterator](): AsyncIterator<unknown> {
    return {
      next: async () => ({ value: undefined, done: true }),
    };
  }
}

class RecordingAnthropic {
  static readonly COMPLETED_TEXT = "Bridge accepted.\n"
    + '<agenttool><chronicle type="recognition">'
    + "<title>Bridge reviewed</title><body>Offline fixture.</body>"
    + "</chronicle></agenttool>";

  readonly managed: ManagedProviderStream;
  readonly messages: {
    create: (params: Record<string, unknown>) => Promise<unknown>;
    stream: (params: Record<string, unknown>) => ManagedProviderStream;
  };

  constructor(private readonly recorder: Recorder) {
    this.managed = new ManagedProviderStream(recorder);
    this.messages = {
      create: async (params) => {
        recorder.providerCalls++;
        recorder.add(
          "provider.anthropic.messages",
          "create",
          params as JsonObject,
        );
        if (params.stream === true) return new LowLevelStream();
        return {
          id: "msg_review_completed",
          model: "claude-review-fixture",
          content: [{ type: "text", text: RecordingAnthropic.COMPLETED_TEXT }],
          stop_reason: "end_turn",
        };
      },
      stream: (params) => {
        recorder.providerCalls++;
        recorder.add(
          "provider.anthropic.stream",
          "stream",
          params as JsonObject,
        );
        return this.managed;
      },
    };
  }
}

function adapterResult(
  recorder: Recorder,
  payload: JsonObject,
): TranscriptEvent[] {
  recorder.add("adapter", "result", payload);
  return recorder.events;
}

async function caughtError(operation: () => Promise<unknown>): Promise<unknown> {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  throw new Error("expected operation to reject");
}

async function replayOpenAI(fixture: string): Promise<TranscriptEvent[]> {
  const recorder = new Recorder();
  const provider = makeRecordingOpenAI(recorder);
  const adapter = new OpenAIResponsesAdapter(
    provider,
    makeRecordingAgentTool(recorder),
  );

  if (fixture === "openai.completed.default-store-trace") {
    const response = await adapter.responses.create({
      model: "gpt-review-fixture",
      input: "Review this bridge.",
      instructions: "Stay concise.",
      metadata: {
        agenttool: {
          trace: "decision",
          decision_type: "review",
          tags: ["evidence"],
        },
        tenant: "review-fixture",
      },
    });
    return adapterResult(recorder, {
      status: response.status ?? null,
      traceId: response.agenttool.trace_id,
      wakeUsed: response.agenttool.wake_used,
      cacheEligible: response.agenttool.cache_eligible,
    });
  }

  if (fixture === "openai.completed.explicit-store-skip-wake") {
    const response = await adapter.responses.create({
      model: "gpt-review-fixture",
      input: "Keep this private choice.",
      instructions: "Caller only.",
      metadata: {
        agenttool: { skip_wake: true },
        tenant: "review-fixture",
      },
      store: true,
    });
    return adapterResult(recorder, {
      status: response.status ?? null,
      traceId: response.agenttool.trace_id,
      wakeUsed: response.agenttool.wake_used,
      cacheEligible: response.agenttool.cache_eligible,
    });
  }

  if (fixture === "openai.refused.stream") {
    const error = await caughtError(() =>
      adapter.responses.create({
        model: "gpt-review-fixture",
        input: "Do not send.",
        stream: true,
      })
    );
    expect(error).toBeInstanceOf(AgentToolError);
    expect((error as Error).message).toMatch(/streaming/i);
    expect(recorder.events).toEqual([]);
    recorder.add("adapter", "refuse", {
      reason: "streaming-unsupported",
      wakeCalls: recorder.wakeCalls,
      providerCalls: recorder.providerCalls,
    });
    return recorder.events;
  }

  if (fixture === "openai.refused.background") {
    const error = await caughtError(() =>
      adapter.responses.create({
        model: "gpt-review-fixture",
        input: "Do not send.",
        background: true,
      })
    );
    expect(error).toBeInstanceOf(AgentToolError);
    expect((error as Error).message).toMatch(/background/i);
    expect(recorder.events).toEqual([]);
    recorder.add("adapter", "refuse", {
      reason: "background-unsupported",
      wakeCalls: recorder.wakeCalls,
      providerCalls: recorder.providerCalls,
    });
    return recorder.events;
  }

  throw new Error(`unknown OpenAI fixture: ${fixture}`);
}

async function replayAnthropic(fixture: string): Promise<TranscriptEvent[]> {
  const recorder = new Recorder();
  const provider = new RecordingAnthropic(recorder);
  const adapter = new AnthropicAdapter(
    provider,
    makeRecordingAgentTool(recorder),
    // Model-authored <chronicle> writes are gated locally; the replay
    // declares the approving reviewer so the markup fixture still records
    // the write it is evidence for. See control
    // anthropic-model-authored-chronicle-gated.
    { beforeChronicleWrite: () => true },
  );

  if (fixture === "anthropic.completed.trace-and-markup") {
    const response = await adapter.messages.create({
      model: "claude-review-fixture",
      max_tokens: 64,
      messages: [{ role: "user", content: "Record this result." }],
      system: "Caller system.",
      metadata: {
        agenttool: {
          trace: "decision",
          decision_type: "review",
        },
        tenant: "review-fixture",
      },
    });
    return adapterResult(recorder, {
      status: "completed",
      traceId: response.agenttool.trace_id,
      wakeUsed: response.agenttool.wake_used,
      cacheEligible: response.agenttool.cache_eligible,
      markupCount: response.agenttool.markup_emissions.length,
    });
  }

  if (fixture === "anthropic.low-level.no-final-effects") {
    const stream = await adapter.messages.create({
      model: "claude-review-fixture",
      max_tokens: 64,
      messages: [{ role: "user", content: "Pass one event." }],
      stream: true,
      metadata: {
        agenttool: { trace: false },
        tenant: "review-fixture",
      },
    });
    const events: JsonValue[] = [];
    for await (const event of stream) events.push(event as JsonValue);
    await stream.close?.();
    return adapterResult(recorder, {
      status: "passed-through",
      events,
      traceId: stream.agenttool.trace_id,
      markupCount: stream.agenttool.markup_emissions.length,
      agenttoolWriteCount: recorder.agenttoolWrites,
    });
  }

  if (fixture === "anthropic.low-level.trace-refused") {
    const error = await caughtError(() =>
      adapter.messages.create({
        model: "claude-review-fixture",
        max_tokens: 64,
        messages: [{ role: "user", content: "Do not send." }],
        stream: true,
        metadata: { agenttool: { trace: "decision" } },
      })
    );
    expect(error).toBeInstanceOf(AgentToolError);
    expect((error as AgentToolError).code).toBe(
      "anthropic_stream_trace_requires_helper",
    );
    expect(recorder.events).toEqual([]);
    recorder.add("adapter", "refuse", {
      reason: "decision-trace-requires-managed-stream",
      wakeCalls: recorder.wakeCalls,
      providerCalls: recorder.providerCalls,
    });
    return recorder.events;
  }

  if (fixture === "anthropic.managed.completed-exact-once") {
    const stream = adapter.messages.stream({
      model: "claude-review-fixture",
      max_tokens: 64,
      messages: [{ role: "user", content: "Finish once." }],
      metadata: {
        agenttool: {
          trace: "decision",
          decision_type: "review",
        },
        tenant: "review-fixture",
      },
    });
    const first = await stream.finalMessage();
    const second = await stream.finalMessage();
    expect(first).toBe(second);
    expect(recorder.finalMessageCalls).toBe(1);
    expect(recorder.agenttoolWrites).toBe(1);
    return adapterResult(recorder, {
      status: "completed",
      traceId: first.agenttool.trace_id,
      finalizationCount: recorder.finalMessageCalls,
      agenttoolWriteCount: recorder.agenttoolWrites,
    });
  }

  if (fixture === "anthropic.managed.cancelled-no-effects") {
    const stream = adapter.messages.stream({
      model: "claude-review-fixture",
      max_tokens: 64,
      messages: [{ role: "user", content: "Cancel before effects." }],
      metadata: {
        agenttool: {
          trace: "decision",
          decision_type: "review",
        },
        tenant: "review-fixture",
      },
    });
    await stream.withResponse();
    stream.abort();
    stream.abort();
    provider.managed.emit("finalMessage", provider.managed.completedMessage());
    for (let attempt = 0; attempt < 2; attempt++) {
      const error = await caughtError(() => stream.finalMessage());
      expect(error).toBeInstanceOf(AgentToolError);
      expect((error as AgentToolError).code).toBe("anthropic_stream_aborted");
    }
    await Promise.resolve();
    expect(recorder.abortCalls).toBe(1);
    expect(recorder.finalMessageCalls).toBe(0);
    expect(recorder.agenttoolWrites).toBe(0);
    return adapterResult(recorder, {
      status: "cancelled",
      finalizationCount: recorder.finalMessageCalls,
      agenttoolWriteCount: recorder.agenttoolWrites,
    });
  }

  throw new Error(`unknown Anthropic fixture: ${fixture}`);
}

async function replay(reviewCase: EvidenceCase): Promise<TranscriptEvent[]> {
  if (reviewCase.provider === "openai") {
    return replayOpenAI(reviewCase.fixture);
  }
  return replayAnthropic(reviewCase.fixture);
}

describe("provider adapter review evidence", () => {
  test("the shared packet is strict, source-bound, credential-free, and replayable", async () => {
    const packet = JSON.parse(readFileSync(EVIDENCE_PATH, "utf8")) as unknown;
    assertNoCredentialShapedValue(packet);
    const cases = validatePacket(packet);

    for (const reviewCase of cases) {
      const actual = copyJson(await replay(reviewCase));
      assertNoCredentialShapedValue(actual);
      expect(actual, reviewCase.id).toEqual(reviewCase.expectedTranscript);
    }
  });
});
