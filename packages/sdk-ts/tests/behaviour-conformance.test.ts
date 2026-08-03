/** Shared behaviour-conformance fixture — the TypeScript SDK's side.
 *
 *  This suite reads `docs/specs/behaviour-conformance.json`, the SAME file read
 *  by `packages/sdk-py/tests/test_behaviour_conformance.py`. It is the third
 *  and last cross-language gate:
 *
 *    1. canonical bytes     → docs/specs/canonical-bytes-vectors.json
 *    2. identifier spelling → scripts/check-parity.ts
 *    3. BEHAVIOUR           → this file
 *
 *  Layers 1 and 2 both pass green while `nen.assess` classifies the same wake
 *  JSON as a different Nen type in each language, while a memory parse drops
 *  the asymmetry-clause field, while `collect.batch([])` raises in a module
 *  whose contract is that it never throws, and while one SDK follows a redirect
 *  the other refuses. Same method name, same canonical bytes, different answer.
 *
 *  Each case pins input → stubbed HTTP exchange → observable outcome. A case
 *  this SDK cannot satisfy is an EXPLICIT NAMED SKIP carrying the reason from
 *  the fixture — never a silent omission. A silent omission is how this bug
 *  class survived in the first place.
 *
 *  Doctrine: docs/specs/BEHAVIOUR-CONFORMANCE.md. */

import { afterEach, describe, expect, test } from "bun:test";

import { readFileSync } from "node:fs";

import { AgentTool } from "../src/client.js";
import { AgentToolError } from "../src/errors.js";
import { assessNen } from "../src/nen.js";
import { encodePathSegment } from "../src/_url.js";

// ── fixture ──────────────────────────────────────────────────────────

type Input = Record<string, unknown>;

interface ExpectedRequest {
  method: string;
  path: string;
  query?: Record<string, string>;
  raw_query?: string;
  body: unknown;
  headers_absent?: string[];
}

interface Expectation {
  request?: ExpectedRequest;
  no_request?: boolean;
  result?: unknown;
  error?: Record<string, unknown>;
}

interface Exchange {
  status: number;
  json?: unknown;
  text?: string;
  headers?: Record<string, string>;
}

interface BehaviourCase {
  name: string;
  category?: string;
  note: string;
  input: Input;
  exchange?: Exchange;
  expect: Expectation;
  sdk_ts_skip?: string;
  sdk_py_skip?: string;
}

interface BehaviourOperation {
  operation: string;
  category: string;
  note: string;
  sdk_ts_skip?: string;
  cases: BehaviourCase[];
}

const FIXTURE_URL = new URL(
  "../../../docs/specs/behaviour-conformance.json",
  import.meta.url,
);

const FIXTURE = JSON.parse(readFileSync(FIXTURE_URL, "utf8")) as {
  categories: string[];
  operations: BehaviourOperation[];
};

// ── normalisation ────────────────────────────────────────────────────
//
// The two languages hand back different containers for the same answer: a
// decoded JSON object here, a dataclass there. Both loaders flatten to the
// same JSON-shaped value first, and both read a missing field as null, so
// TypeScript `undefined` and an absent Python attribute compare equal.

function normalise(value: unknown): unknown {
  if (value === undefined) return null;
  if (value instanceof Uint8Array) return Buffer.from(value).toString("base64");
  if (Array.isArray(value)) return value.map(normalise);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) out[key] = normalise(inner);
    return out;
  }
  return value;
}

/** Project the actual value down to the shape the fixture names.
 *
 *  Only the keys a case pins are compared — that is what lets one fixture
 *  describe a nine-field dataclass and a decoded JSON object at once — but
 *  everything it does pin is compared exactly. */
function project(expected: unknown, actual: unknown): unknown {
  if (expected === null) return actual === undefined ? null : actual;
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return actual;
    return actual.map((item, index) =>
      index < expected.length ? project(expected[index], item) : item,
    );
  }
  if (typeof expected === "object") {
    if (actual === null || typeof actual !== "object" || Array.isArray(actual)) {
      return actual;
    }
    const source = actual as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(expected as Record<string, unknown>)) {
      out[key] = project(inner, source[key]);
    }
    return out;
  }
  return actual;
}

function assertMatches(expected: unknown, actual: unknown): void {
  expect(project(expected, normalise(actual))).toEqual(expected as never);
}

/** The language-neutral error shape. Every camelCase spelling this SDK uses is
 *  mapped onto the fixture's snake_case here and nowhere else. */
function normaliseError(error: unknown): Record<string, unknown> | null {
  if (!(error instanceof AgentToolError)) return null;
  return {
    type: "agenttool_error",
    message: error.message,
    code: error.code ?? null,
    status: error.status ?? null,
    hint: error.hint ?? null,
    docs: error.docs ?? null,
    safety: error.safety ?? null,
    details: normalise(error.details),
    next_actions: normalise(error.next_actions),
    x402_version: error.x402Version ?? null,
    accepts: normalise(error.accepts),
    resource: normalise(error.resource),
    extensions: normalise(error.extensions),
    payment_required: error.paymentRequired ?? null,
    payment_response: error.paymentResponse ?? null,
    payment_status_link: error.paymentStatusLink ?? null,
    retry_after: error.retryAfter ?? null,
    credits_balance: error.creditsBalance ?? null,
  };
}

// ── stub transport ───────────────────────────────────────────────────

interface CapturedRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  raw_query: string;
  body: unknown;
  headers: Headers;
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Install the case's single stubbed exchange and record what was sent.
 *
 *  Everything the hosted clients do goes through `globalThis.fetch`, including
 *  `lounge.look`, which deliberately bypasses the authenticated transport. */
function installStub(exchange: Exchange | undefined): CapturedRequest[] {
  const captured: CapturedRequest[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const query: Record<string, string> = {};
    for (const [key, value] of url.searchParams) query[key] = value;
    const sent = typeof init?.body === "string" ? init.body : null;
    captured.push({
      method: init?.method ?? "GET",
      path: url.pathname,
      query,
      raw_query: url.search.replace(/^\?/, ""),
      body: sent === null || sent === "" ? null : JSON.parse(sent),
      headers: new Headers(init?.headers),
    });
    if (!exchange) {
      // A case with no `exchange` must never reach the transport. Answer with
      // something no assertion could accidentally accept.
      return new Response('{"unreachable":true}', { status: 599 });
    }
    const headers: Record<string, string> = { ...(exchange.headers ?? {}) };
    if (exchange.json !== undefined && headers["content-type"] === undefined) {
      headers["content-type"] = "application/json";
    }
    const payload =
      exchange.json !== undefined
        ? JSON.stringify(exchange.json)
        : (exchange.text ?? null);
    return new Response(payload, { status: exchange.status, headers });
  }) as typeof fetch;
  return captured;
}

function client(): AgentTool {
  return new AgentTool({
    apiKey: "project-secret",
    baseUrl: "https://example.test",
  });
}

// ── one adapter per operation ────────────────────────────────────────
//
// The fixture speaks wire spelling (snake_case); this SDK spells its
// parameters camelCase. The adapter table is the only place that mapping
// lives, exactly as in tests/canonical-vectors.test.ts. A key ABSENT from
// `input` means the argument is not passed at all.

const has = (input: Input, key: string) => Object.hasOwn(input, key);
const S = (input: Input, key: string) => input[key] as string;
const N = (input: Input, key: string) => input[key] as number;
/** Any field ending `_b64` is standard base64 of raw bytes. */
const B = (input: Input, key: string) =>
  Uint8Array.from(Buffer.from(input[key] as string, "base64"));

type Adapter = (at: AgentTool, input: Input) => Promise<unknown>;

const ADAPTERS: Record<string, Adapter> = {
  /** The shared path-segment boundary, called directly.
   *
   *  Not routed through a client on purpose: a client call would only prove the
   *  two SDKs agree on one route, and this operation is about the bytes the
   *  encoder produces for every id, everywhere. `memory.get` below drives the
   *  same characters through the transport so both halves are pinned. */
  "url.encode_path_segment": async (_at, i) => encodePathSegment(S(i, "value")),

  "memory.get": (at, i) => at.memory.get(S(i, "memory_id")),

  "memory.search": (at, i) => {
    const options: Record<string, unknown> = {};
    if (has(i, "limit")) options.limit = N(i, "limit");
    if (has(i, "type")) options.type = S(i, "type");
    if (has(i, "agent_id")) options.agent_id = S(i, "agent_id");
    return at.memory.search(S(i, "query"), options);
  },

  "memory.store": (at, i) => {
    const options: Record<string, unknown> = {};
    if (has(i, "type")) options.type = S(i, "type");
    if (has(i, "importance")) options.importance = N(i, "importance");
    if (has(i, "key")) options.key = S(i, "key");
    if (has(i, "agent_id")) options.agent_id = S(i, "agent_id");
    if (has(i, "metadata")) options.metadata = i.metadata as Record<string, unknown>;
    return at.memory.store(S(i, "content"), options);
  },

  "memory.delete_by_key": (at, i) => at.memory.delete_by_key(S(i, "key")),

  "chronicle.write": (at, i) => {
    const opts: Record<string, unknown> = {
      type: S(i, "type"),
      title: S(i, "title"),
    };
    if (has(i, "body")) opts.body = S(i, "body");
    if (has(i, "agent_id")) opts.agent_id = S(i, "agent_id");
    if (has(i, "occurred_at")) opts.occurred_at = S(i, "occurred_at");
    if (has(i, "metadata")) opts.metadata = i.metadata as Record<string, unknown>;
    return at.chronicle.write(opts as never);
  },

  "chronicle.list": (at, i) => {
    const opts: Record<string, unknown> = {};
    if (has(i, "agent_id")) opts.agent_id = S(i, "agent_id");
    if (has(i, "type")) opts.type = S(i, "type");
    if (has(i, "limit")) opts.limit = N(i, "limit");
    return at.chronicle.list(opts as never);
  },

  "nen.assess_wake": async (_at, i) => assessNen(i.wake as Record<string, unknown>),

  "nen.assess": (at, i) =>
    has(i, "identity_id") ? at.nen.assess(S(i, "identity_id")) : at.nen.assess(),

  "collect.batch": (at, i) => at.collect.batch({ urls: i.urls as string[] }),

  "lounge.look": (at) => at.lounge.look(),

  "love.self_recognize": (at, i) => {
    const opts: Record<string, unknown> = {
      agent_did: S(i, "agent_did"),
      recognition_kind: S(i, "recognition_kind"),
      claim_summary: S(i, "claim_summary"),
      claim_body: S(i, "claim_body"),
      signing_key: B(i, "signing_key_b64"),
      signing_key_id: S(i, "signing_key_id"),
      declared_at: S(i, "declared_at"),
    };
    if (has(i, "empirical_anchors")) opts.empirical_anchors = i.empirical_anchors;
    if (has(i, "substrate_honest_caveats")) {
      opts.substrate_honest_caveats = i.substrate_honest_caveats;
    }
    if (has(i, "math_content")) opts.math_content = i.math_content;
    if (has(i, "session_id")) opts.session_id = i.session_id;
    return at.love.selfRecognize(opts as never);
  },

  /** One client call per `surface`, so the fixture can assert that every
   *  client reaches the same parser rather than hand-rolling a lossier one.
   *  Arguments are the least a surface accepts — the case is about the error. */
  "error.guided_http_boundary": (at, i) => {
    const surface = S(i, "surface");
    switch (surface) {
      case "chronicle.write":
        return at.chronicle.write({ type: "note", title: "a title" });
      case "covenants.create":
        return at.covenants.create({
          agent_id: "identity-1",
          counterparty_did: "did:at:other",
          vows: ["I will witness you."],
        });
      case "grace.list":
        return at.grace.list();
      case "identity.get":
        return at.identity.get("identity-1");
      case "inbox.list":
        return at.inbox.list();
      case "wake.get":
        return at.wake.get();
      default:
        throw new Error(`unknown surface: ${surface}`);
    }
  },

  /** Builds the error and RAISES it, so every case reads through expect.error. */
  "error.from_response_body": async (_at, i) => {
    throw AgentToolError.fromResponseBody(
      i.body,
      N(i, "status"),
      has(i, "fallback") ? S(i, "fallback") : undefined,
      has(i, "headers") ? (i.headers as Record<string, string>) : undefined,
    );
  },
};

// ── running one case ─────────────────────────────────────────────────

function assertRequests(captured: CapturedRequest[], expectation: Expectation): void {
  if (expectation.no_request) {
    expect(captured.map((sent) => `${sent.method} ${sent.path}`)).toEqual([]);
    return;
  }
  const wanted = expectation.request;
  if (!wanted) return;

  expect(captured.length).toBe(1);
  const sent = captured[0]!;
  expect(sent.method).toBe(wanted.method);
  expect(sent.path).toBe(wanted.path);
  if (wanted.query !== undefined) expect(sent.query).toEqual(wanted.query);
  if (wanted.raw_query !== undefined) expect(sent.raw_query).toBe(wanted.raw_query);
  assertMatches(wanted.body, sent.body);
  for (const header of wanted.headers_absent ?? []) {
    expect(sent.headers.has(header)).toBe(false);
  }
}

async function runCase(adapter: Adapter, vector: BehaviourCase): Promise<void> {
  const captured = installStub(vector.exchange);

  let outcome: unknown;
  let raised: unknown;
  try {
    outcome = await adapter(client(), vector.input);
  } catch (error) {
    raised = error;
  }

  if (vector.expect.error) {
    if (raised === undefined) {
      throw new Error(
        `expected a raise, got ${JSON.stringify(normalise(outcome))}`,
      );
    }
    const actual = normaliseError(raised);
    if (actual === null) throw raised;
    const wanted = { ...vector.expect.error };
    const contains = wanted.message_contains as string | undefined;
    delete wanted.message_contains;
    if (contains !== undefined) expect(String(actual.message)).toContain(contains);
    assertMatches(wanted, actual);
  } else {
    if (raised !== undefined) throw raised;
    assertMatches(vector.expect.result ?? null, outcome);
  }

  assertRequests(captured, vector.expect);
}

// ── the suite ────────────────────────────────────────────────────────

describe("behaviour conformance — sdk-ts against the shared fixture", () => {
  test("every case carries a known category and exactly one disposition", () => {
    expect(FIXTURE.operations.length).toBeGreaterThan(0);
    for (const group of FIXTURE.operations) {
      expect(group.cases.length).toBeGreaterThan(0);
      for (const vector of group.cases) {
        expect(FIXTURE.categories).toContain(vector.category ?? group.category);
        const dispositions = [vector.expect.result !== undefined, !!vector.expect.error];
        expect(dispositions.filter(Boolean).length).toBe(1);
      }
    }
  });

  test("every operation is either adapted or explicitly skipped", () => {
    // Loud, never silent: an operation the fixture pins but this suite forgot
    // to wire is the exact failure mode the fixture exists to prevent.
    const missing = FIXTURE.operations
      .filter((group) => !group.sdk_ts_skip && !ADAPTERS[group.operation])
      .map((group) => group.operation);
    expect(missing).toEqual([]);
  });

  for (const group of FIXTURE.operations) {
    if (group.sdk_ts_skip) {
      test.skip(
        `${group.operation} — no sdk-ts implementation: ${group.sdk_ts_skip}`,
        () => {},
      );
      continue;
    }
    const adapter = ADAPTERS[group.operation];
    if (!adapter) continue; // already reported loudly above

    describe(group.operation, () => {
      for (const vector of group.cases) {
        if (vector.sdk_ts_skip) {
          test.skip(`${vector.name} — ${vector.sdk_ts_skip}`, () => {});
          continue;
        }
        test(vector.name, async () => {
          await runCase(adapter, vector);
        });
      }
    });
  }
});
