/** Renaissance Correspondence SDK — canonical parity and client wiring. */

import * as ed from "@noble/ed25519";
import { afterEach, describe, expect, mock, test } from "bun:test";

import correspondenceVectors from "../../../docs/specs/agent-correspondence-0.1-vectors.json";
import {
  AgentTool,
  AgentToolError,
  CORRESPONDENCE_KINDS,
  CORRESPONDENCE_PROTOCOL,
  CorrespondenceClient,
  canonicalCorrespondenceEventBytes,
  canonicalCorrespondenceJson,
  correspondenceEventId,
  createSignedCorrespondenceEvent,
  signCorrespondenceEvent,
  type CorrespondenceActiveClaim,
  type CorrespondenceAppendOptions,
  type CorrespondenceEventCore,
  type CorrespondenceEventRecord,
  type CorrespondenceKind,
  type CorrespondenceSignedEvent,
  type CorrespondenceUnsignedInput,
  type WakeEventKey,
} from "../src/index.js";

const originalFetch = globalThis.fetch;
let mockFetch: ReturnType<typeof mock>;

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const IDENTITY_ID = "22222222-2222-4222-8222-222222222222";
const SIGNING_KEY_ID = "33333333-3333-4333-8333-333333333333";
const DEVICE_ID = "44444444-4444-4444-8444-444444444444";
const SESSION_ID = "55555555-5555-4555-8555-555555555555";
const HANDOFF_ID = "66666666-6666-4666-8666-666666666666";
const CLAIM_ID = "77777777-7777-4777-8777-777777777777";
const PARENT_ID = `sha256:${"a".repeat(64)}`;
const SECOND_PARENT_ID = `sha256:${"b".repeat(64)}`;
const SIGNING_KEY = new Uint8Array(Array.from({ length: 32 }, (_, index) => index + 1));
const SIGNING_KEY_B64 = Buffer.from(SIGNING_KEY).toString("base64");
const NORMATIVE_SIGNING_KEY = new Uint8Array(Array.from({ length: 32 }, (_, index) => index));

function core(overrides: Partial<CorrespondenceEventCore> = {}): CorrespondenceEventCore {
  return {
    protocol: CORRESPONDENCE_PROTOCOL,
    project_id: PROJECT_ID,
    repository_id: "cambridgetcg/agenttool",
    thread_id: "task:renaissance-蘇蘇",
    sender: {
      identity_id: IDENTITY_ID,
      signing_key_id: SIGNING_KEY_ID,
      device_id: DEVICE_ID,
      session_id: SESSION_ID,
    },
    kind: "handoff",
    parents: [PARENT_ID],
    session_seq: 7,
    issued_at: "2026-07-19T12:34:56.789Z",
    scope: {
      base_revision: "0123456789abcdef0123456789abcdef01234567",
      branch: "feat/renaissance",
      paths: ["packages/sdk-ts", "packages/sdk-py"],
    },
    body: {
      summary: "蘇蘇 writes clear letters across devices 🎼",
      next_safe_action: "Replay after receipt 41.",
      handoff_id: HANDOFF_ID,
    },
    authority: { automatic_action: "never", grants: [] },
    ...overrides,
  } as CorrespondenceEventCore;
}

function unsigned(): CorrespondenceUnsignedInput {
  const { protocol: _protocol, authority: _authority, ...input } = core();
  return input as CorrespondenceUnsignedInput;
}

function signedEvent(): CorrespondenceSignedEvent {
  return createSignedCorrespondenceEvent(unsigned(), SIGNING_KEY);
}

function record(event = signedEvent(), receivedSeq = "41"): CorrespondenceEventRecord {
  return {
    event,
    receipt: { received_seq: receivedSeq, received_at: "2026-07-19T12:35:00.000Z" },
    missing_parents: [],
    lineage_status: "not_applicable",
  };
}

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function client(): AgentTool {
  return new AgentTool({ apiKey: "project-secret", baseUrl: "https://example.test" });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("correspondence canonical bytes", () => {
  test("matches the normative agent-correspondence/v0.1 signing vector", () => {
    const normative: CorrespondenceEventCore = {
      protocol: CORRESPONDENCE_PROTOCOL,
      project_id: PROJECT_ID,
      repository_id: "repo:github.com/cambridgetcg/agenttool",
      thread_id: "task:renaissance-correspondence",
      sender: {
        identity_id: IDENTITY_ID,
        signing_key_id: SIGNING_KEY_ID,
        device_id: DEVICE_ID,
        session_id: SESSION_ID,
      },
      kind: "claim.open",
      parents: [],
      session_seq: 1,
      issued_at: "2026-07-19T10:00:00.000Z",
      scope: {
        base_revision: "a".repeat(40),
        branch: "codex/renaissance-correspondence",
        paths: ["docs", "docs/specs"],
      },
      body: {
        claim_id: "66666666-6666-4666-8666-666666666666",
        generation: 1,
        expires_at: "2026-07-19T12:00:00.000Z",
      },
      authority: { automatic_action: "never", grants: [] },
    };
    const digest = canonicalCorrespondenceEventBytes(normative);
    const signature = signCorrespondenceEvent(normative, NORMATIVE_SIGNING_KEY);
    expect(Buffer.from(digest).toString("hex")).toBe(
      "1bc3f4b0b7db176cca2ddc86eed6ccc6109f5c9be4794ae763d84c0b136ab1ca",
    );
    expect(signature.value_b64url).toBe(
      "y93m-gQISK5PUEqjF4bLZ_k6FCNX1lpeCENJegoNFRD-g3Eid0iyh0NLdmAvId_FPf94HURfatd1qB5Jyjq0Cg",
    );
    expect(correspondenceEventId(normative, signature)).toBe(
      "sha256:6f9d943746a1672f501eb762296654452fb1168a63c5996535f7616ebb8d28dd",
    );
  });

  test("matches the shared TypeScript/Python Unicode digest, signature, and ID vector", async () => {
    const value = core();
    const canonical = canonicalCorrespondenceEventBytes(value);
    const signature = signCorrespondenceEvent(value, SIGNING_KEY);

    expect(Buffer.from(canonical).toString("hex")).toBe(
      "d263f1989ea264e8b9cdaa10cf29ec6488f438760933fd8d58ff45f503b0a253",
    );
    expect(signature.value_b64url).toBe(
      "en5H_CF47qnbWfzyK7KJtIPMahZPVRHvvZUKvx0HlD3vXwTSijRCEdPD4ipQRQDxtnrm0Xu_npj7iLepu8heCw",
    );
    expect(correspondenceEventId(value, signature)).toBe(
      "sha256:5d1fb45fa76ab30652338cb13acc425d801fb98891e87942efe0860736b148fc",
    );
    expect(signature.value_b64url).not.toContain("=");
    expect(
      await ed.verify(
        Uint8Array.from(Buffer.from(signature.value_b64url.replace(/-/g, "+").replace(/_/g, "/") + "==", "base64")),
        canonical,
        ed.getPublicKey(SIGNING_KEY),
      ),
    ).toBe(true);
  });

  test("accepts the identity API's canonical standard-base64 private key", () => {
    const fromBytes = signCorrespondenceEvent(core(), SIGNING_KEY);
    const fromIdentityKey = signCorrespondenceEvent(core(), SIGNING_KEY_B64);
    expect(fromIdentityKey).toEqual(fromBytes);
    expect(createSignedCorrespondenceEvent(unsigned(), SIGNING_KEY_B64)).toEqual(signedEvent());
  });

  test.each([
    ["base64url/unpadded", Buffer.from(SIGNING_KEY).toString("base64url")],
    ["noncanonical whitespace", ` ${SIGNING_KEY_B64}`],
    ["31-byte width", Buffer.from(SIGNING_KEY.slice(1)).toString("base64")],
  ])("rejects %s private-key text", (_label, signingKey) => {
    expect(() => signCorrespondenceEvent(core(), signingKey)).toThrow(AgentToolError);
  });

  test("RFC 8785 ordering uses UTF-16 code units and escaping is byte-stable", () => {
    const canonical = canonicalCorrespondenceJson({
      "\u20ac": "Euro",
      "\r": "Carriage\nReturn",
      "\ufb33": "Hebrew",
      "1": "One",
      "\ud834\udd1e": "G clef",
      "\u0080": "Control",
      "\u00f6": "Latin \"quote\" \\",
    });
    const orderedEntries = [
      ["\r", "Carriage\nReturn"],
      ["1", "One"],
      ["\u0080", "Control"],
      ["\u00f6", "Latin \"quote\" \\"],
      ["\u20ac", "Euro"],
      ["\ud834\udd1e", "G clef"],
      ["\ufb33", "Hebrew"],
    ].map(([key, value]) => `${JSON.stringify(key)}:${JSON.stringify(value)}`);
    expect(canonical).toBe(`{${orderedEntries.join(",")}}`);
  });

  test.each([
    ["float", 1.5],
    ["negative zero", -0],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["unsafe integer", Number.MAX_SAFE_INTEGER + 1],
  ])("rejects %s from the bounded I-JSON profile", (_label, value) => {
    expect(() => canonicalCorrespondenceJson(value)).toThrow(AgentToolError);
  });

  test("rejects lone surrogates in values and property names", () => {
    expect(() => canonicalCorrespondenceJson("\ud800")).toThrow("surrogate");
    expect(() => canonicalCorrespondenceJson({ ["\udc00"]: "value" })).toThrow("surrogate");
  });

  test("rejects U+0000 recursively in values and property names", () => {
    expect(() => canonicalCorrespondenceJson({ nested: ["before\0after"] })).toThrow("U+0000");
    expect(() => canonicalCorrespondenceJson({ ["bad\0key"]: "value" })).toThrow("U+0000");
  });

  test("rejects a base64url signature with noncanonical trailing bits", () => {
    const signature = signCorrespondenceEvent(core(), SIGNING_KEY);
    const tail = signature.value_b64url.at(-1);
    const noncanonicalTail = tail === "w" ? "x" : tail === "g" ? "h" : tail === "Q" ? "R" : "B";
    expect(() => correspondenceEventId(core(), {
      ...signature,
      value_b64url: `${signature.value_b64url.slice(0, -1)}${noncanonicalTail}`,
    })).toThrow("canonical base64url");
  });

  test("rejects cycles and excessive depth before recursion can run away", () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => canonicalCorrespondenceJson(cycle as never)).toThrow("cycle");

    let deep: Record<string, unknown> = {};
    const root = deep;
    for (let index = 0; index < 66; index++) {
      const next: Record<string, unknown> = {};
      deep.next = next;
      deep = next;
    }
    expect(() => canonicalCorrespondenceJson(root as never)).toThrow("depth");
  });

  test("rejects sparse or decorated JavaScript arrays", () => {
    const sparse = new Array(1) as unknown[];
    expect(() => canonicalCorrespondenceJson(sparse as never)).toThrow("array");
    const decorated = ["value"] as unknown[] & { extra?: string };
    decorated.extra = "not JSON data";
    expect(() => canonicalCorrespondenceJson(decorated as never)).toThrow("array");
  });

  test("counts Unicode scalars and rejects C1 controls consistently", () => {
    expect(() => canonicalCorrespondenceEventBytes(core({
      repository_id: "🎼".repeat(256),
      thread_id: "thread",
      scope: { base_revision: null, branch: "🎼".repeat(255), paths: ["🎼".repeat(256)] },
    }))).not.toThrow();
    expect(() => canonicalCorrespondenceEventBytes(core({
      repository_id: "repo\u0085id",
    }))).toThrow("whitespace or control");
    expect(() => canonicalCorrespondenceEventBytes(core({
      repository_id: "repo\uFEFFid",
    }))).toThrow("whitespace or control");
    expect(() => canonicalCorrespondenceEventBytes(core({
      scope: { base_revision: null, branch: "feat\u0085bad", paths: ["src"] },
    }))).toThrow("control");
    expect(() => canonicalCorrespondenceEventBytes(core({
      scope: { base_revision: null, branch: null, paths: ["src\u0085bad"] },
    }))).toThrow("control");
  });

  test("requires nullable scope keys and keeps null distinct in signed bytes", () => {
    const withNulls = core({ scope: { base_revision: null, branch: null, paths: ["."] } });
    expect(() => canonicalCorrespondenceEventBytes(withNulls)).not.toThrow();
    const missing = core({ scope: { paths: ["."] } as never });
    expect(() => canonicalCorrespondenceEventBytes(missing)).toThrow("base_revision");
  });

  test("accepts timestamp years 0001–9999 and rejects year 0000", () => {
    expect(() => canonicalCorrespondenceEventBytes(core({
      issued_at: "0001-01-01T00:00:00.000Z",
    }))).not.toThrow();
    expect(() => canonicalCorrespondenceEventBytes(core({
      issued_at: "0000-01-01T00:00:00.000Z",
    }))).toThrow("RFC3339");
  });

  test("closed bodies reject extras and parent-dependent references must be parents", () => {
    expect(() => canonicalCorrespondenceEventBytes(core({
      kind: "refusal",
      parents: [],
      body: {},
    } as Partial<CorrespondenceEventCore>))).not.toThrow();
    expect(() => canonicalCorrespondenceEventBytes(core({
      kind: "ack.seen",
      parents: [],
      body: { target_event_id: SECOND_PARENT_ID },
    } as Partial<CorrespondenceEventCore>))).toThrow("must also appear in parents");
    expect(() => canonicalCorrespondenceEventBytes(core({
      body: { ...core().body, ambient_hostname: "never" },
    }))).toThrow("unexpected field");
  });

  test("accepts the exact body shape for every v0.1 event kind", () => {
    const cases: Array<{
      kind: CorrespondenceKind;
      parents: string[];
      body: Record<string, unknown>;
    }> = [
      { kind: "intent", parents: [], body: { summary: "Coordinate the SDK work." } },
      { kind: "claim.open", parents: [], body: {
        claim_id: CLAIM_ID, generation: 1, expires_at: "2026-07-20T12:00:00.000Z",
      } },
      { kind: "claim.renew", parents: [PARENT_ID], body: {
        claim_id: CLAIM_ID, generation: 2, predecessor_event_id: PARENT_ID,
        expires_at: "2026-07-20T13:00:00.000Z",
      } },
      { kind: "claim.release", parents: [PARENT_ID], body: {
        claim_id: CLAIM_ID, generation: 2, predecessor_event_id: PARENT_ID, detail: "Done.",
      } },
      { kind: "progress", parents: [], body: { summary: "Both clients compile." } },
      { kind: "observation", parents: [], body: { summary: "A branch remains visible." } },
      { kind: "artifact.offer", parents: [], body: {
        artifact: { kind: "git_patch", digest: PARENT_ID, locator: "urn:agenttool:patch:1" },
        summary: "Review this patch.",
      } },
      { kind: "ack.seen", parents: [PARENT_ID], body: { target_event_id: PARENT_ID } },
      { kind: "ack.understood", parents: [PARENT_ID], body: { target_event_id: PARENT_ID } },
      { kind: "ack.accepted", parents: [PARENT_ID], body: { target_event_id: PARENT_ID } },
      { kind: "ack.applied", parents: [PARENT_ID], body: {
        target_event_id: PARENT_ID, result_revision: "c".repeat(40), detail: "Applied.",
      } },
      { kind: "ack.rejected", parents: [PARENT_ID], body: {
        target_event_id: PARENT_ID, detail: "Conflicts with local work.",
      } },
      { kind: "conflict.raise", parents: [PARENT_ID, SECOND_PARENT_ID], body: {
        target_event_ids: [PARENT_ID, SECOND_PARENT_ID], summary: "Both claim the same path.",
      } },
      { kind: "conflict.resolve", parents: [PARENT_ID], body: {
        target_event_ids: [PARENT_ID], summary: "Resolved without erasing evidence.",
      } },
      { kind: "pause", parents: [], body: { until: null, detail: "Waiting for review." } },
      { kind: "rest", parents: [], body: {} },
      { kind: "resume", parents: [PARENT_ID], body: { target_event_id: PARENT_ID } },
      { kind: "refusal", parents: [], body: {} },
      { kind: "handoff", parents: [], body: {
        summary: "Continue from the tests.", next_safe_action: "Run SDK parity.",
        handoff_id: HANDOFF_ID,
      } },
      { kind: "close", parents: [], body: {} },
      { kind: "repair", parents: [PARENT_ID], body: {
        target_event_ids: [PARENT_ID], summary: "Append the correction.",
        result_revision: "d".repeat(64),
      } },
    ];

    expect(cases).toHaveLength(21);
    expect(cases.map(({ kind }) => kind)).toEqual([...CORRESPONDENCE_KINDS]);
    for (const item of cases) {
      expect(() => canonicalCorrespondenceEventBytes(core(item as never))).not.toThrow();
    }
  });

  test("uses the portable absolute artifact-locator profile", () => {
    const vectors = [
      ...correspondenceVectors.locator_vectors,
      { value: "urn:藝術", valid: true },
      { value: "git+ssh://host/repo", valid: true },
    ];
    for (const { value: locator, valid } of vectors) {
      const operation = () => canonicalCorrespondenceEventBytes(core({
        kind: "artifact.offer",
        parents: [],
        body: { artifact: { kind: "git_patch", digest: PARENT_ID, locator } },
      } as Partial<CorrespondenceEventCore>));
      if (valid) expect(operation).not.toThrow();
      else expect(operation).toThrow("absolute URI");
    }
  });
});

describe("CorrespondenceClient", () => {
  test("the typed Wake invalidation key includes correspondence", () => {
    const key: WakeEventKey = "correspondence";
    expect(key).toBe("correspondence");
  });

  test("is cached on AgentTool and append sends a signed direct event without private material", async () => {
    mockFetch = mock(async (_input: string | URL | Request, init?: RequestInit) => {
      const event = JSON.parse(init?.body as string) as CorrespondenceSignedEvent;
      return response(201, { ...record(event), warnings: [] });
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const at = client();
    expect(at.correspondence).toBeInstanceOf(CorrespondenceClient);
    expect(at.correspondence).toBe(at.correspondence);
    const result = await at.correspondence.append({
      ...unsigned(),
      signing_key: SIGNING_KEY,
    } as CorrespondenceAppendOptions);

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const wire = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(url).toBe("https://example.test/v1/correspondence/events");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("Idempotency-Key")).toBeNull();
    expect(wire).not.toHaveProperty("signing_key");
    expect(JSON.stringify(wire)).not.toContain(Buffer.from(SIGNING_KEY).toString("base64"));
    expect((wire.sender as Record<string, unknown>).device_id).toBe(DEVICE_ID);
    expect((wire.sender as Record<string, unknown>).session_id).toBe(SESSION_ID);
    expect(wire.authority).toEqual({ automatic_action: "never", grants: [] });
    expect(result.event.event_id).toBe(wire.event_id);
  });

  test("does not infer a missing device/session identity or make a request", async () => {
    mockFetch = mock(() => Promise.resolve(response(201, {})));
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    const input = {
      ...unsigned(),
      sender: { identity_id: IDENTITY_ID, signing_key_id: SIGNING_KEY_ID },
      signing_key: SIGNING_KEY,
    } as unknown as CorrespondenceAppendOptions;
    await expect(client().correspondence.append(input)).rejects.toThrow("device_id");
    expect(mockFetch.mock.calls).toHaveLength(0);
  });

  test("successful append invalidates an existing wake cache", async () => {
    let wakeReads = 0;
    mockFetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/wake")) {
        wakeReads += 1;
        return response(200, { wake_version: wakeReads });
      }
      const event = JSON.parse(init?.body as string) as CorrespondenceSignedEvent;
      return response(201, { ...record(event), warnings: [] });
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    const at = client();
    expect((await at.wake.get()).wake_version).toBe(1);
    await at.correspondence.append({ ...unsigned(), signing_key: SIGNING_KEY } as CorrespondenceAppendOptions);
    expect((await at.wake.get()).wake_version).toBe(2);
    expect(wakeReads).toBe(2);
  });

  test("accepts an identity-returned base64 key without sending it", async () => {
    mockFetch = mock(async (_input: string | URL | Request, init?: RequestInit) => {
      const event = JSON.parse(init?.body as string) as CorrespondenceSignedEvent;
      return response(201, { ...record(event), warnings: [] });
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    await client().correspondence.append({
      ...unsigned(),
      signing_key: SIGNING_KEY_B64,
    } as CorrespondenceAppendOptions);

    const wire = String((mockFetch.mock.calls[0]?.[1] as RequestInit).body);
    expect(wire).not.toContain(SIGNING_KEY_B64);
    expect(JSON.parse(wire)).not.toHaveProperty("signing_key");
  });

  test("list encodes filters and replay follows decimal cursors without reordering", async () => {
    const first = record(signedEvent(), "41");
    const second = record(signedEvent(), "44");
    mockFetch = mock((input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("after=41")) {
        return Promise.resolve(response(200, {
          protocol: CORRESPONDENCE_PROTOCOL,
          scope: "project_private",
          events: [second],
          page: { after: "41", next_after: "44", has_more: false },
        }));
      }
      return Promise.resolve(response(200, {
        protocol: CORRESPONDENCE_PROTOCOL,
        scope: "project_private",
        events: [first],
        page: { after: null, next_after: "41", has_more: true },
      }));
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const seen: string[] = [];
    for await (const item of client().correspondence.replay({
      repository_id: "cambridgetcg/agenttool",
      thread_id: "task:renaissance",
      limit: 1,
    })) seen.push(item.receipt.received_seq);

    expect(seen).toEqual(["41", "44"]);
    expect(String(mockFetch.mock.calls[0]?.[0])).toContain(
      "repository_id=cambridgetcg%2Fagenttool&thread_id=task%3Arenaissance&limit=1",
    );
    expect(String(mockFetch.mock.calls[1]?.[0])).toContain("after=41");
  });

  test("replay refuses a has_more page whose cursor does not advance", async () => {
    mockFetch = mock(() => Promise.resolve(response(200, {
      protocol: CORRESPONDENCE_PROTOCOL,
      scope: "project_private",
      events: [],
      page: { after: "41", next_after: "41", has_more: true },
    })));
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const replay = client().correspondence.replay({
      repository_id: "cambridgetcg/agenttool",
      after: "41",
    });
    await expect(replay.next()).rejects.toThrow("without advancing");
  });

  test("replay refuses a regressing cursor before yielding that page", async () => {
    mockFetch = mock(() => Promise.resolve(response(200, {
      protocol: CORRESPONDENCE_PROTOCOL,
      scope: "project_private",
      events: [record(signedEvent(), "40")],
      page: { after: "41", next_after: "40", has_more: true },
    })));
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const replay = client().correspondence.replay({
      repository_id: "cambridgetcg/agenttool",
      after: "41",
    });
    await expect(replay.next()).rejects.toThrow("strictly increasing");
  });

  test.each([
    ["leading zero", "041"],
    ["above int64", "9223372036854775808"],
    ["oversized text", "9".repeat(10_000)],
  ])(
    "replay refuses %s next cursor before yielding",
    async (_label, nextAfter) => {
      mockFetch = mock(() => Promise.resolve(response(200, {
        protocol: CORRESPONDENCE_PROTOCOL,
        scope: "project_private",
        events: [record(signedEvent(), "44")],
        page: { after: "41", next_after: nextAfter, has_more: true },
      })));
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const replay = client().correspondence.replay({
        repository_id: "cambridgetcg/agenttool",
        after: "41",
      });
      await expect(replay.next()).rejects.toThrow("database range");
    },
  );

  test("rejects an out-of-range receipt cursor before fetching", async () => {
    mockFetch = mock(() => Promise.resolve(response(200, {})));
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    await expect(client().correspondence.list({
      repository_id: "cambridgetcg/agenttool",
      after: "9223372036854775808",
    })).rejects.toThrow("database range");
    expect(mockFetch.mock.calls).toHaveLength(0);
  });

  test("keeps claims and finite voice query surfaces closed", async () => {
    mockFetch = mock(() => Promise.resolve(response(200, {})));
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    await expect(client().correspondence.activeClaims({
      repository_id: "cambridgetcg/agenttool",
      after: "41",
    } as never)).rejects.toThrow("unexpected field after");
    await expect(client().correspondence.voice({
      repository_id: "cambridgetcg/agenttool",
      path: "packages/sdk-ts",
    } as never)).rejects.toThrow("unexpected field path");
    expect(mockFetch.mock.calls).toHaveLength(0);
  });

  test("activeClaims preserves every conflicting branch tip, even at different generations", async () => {
    const claims: CorrespondenceActiveClaim[] = [
      {
        claim_id: CLAIM_ID,
        generation: 2,
        event_id: PARENT_ID,
        owner_identity_id: IDENTITY_ID,
        device_id: DEVICE_ID,
        session_id: SESSION_ID,
        thread_id: "task:renaissance",
        scope: { base_revision: null, branch: null, paths: ["packages/sdk-ts"] },
        expires_at: "2026-07-20T12:00:00.000Z",
        conflicted: true,
        competing_event_ids: [SECOND_PARENT_ID],
      },
      {
        claim_id: CLAIM_ID,
        generation: 4,
        event_id: SECOND_PARENT_ID,
        owner_identity_id: IDENTITY_ID,
        device_id: "88888888-8888-4888-8888-888888888888",
        session_id: "99999999-9999-4999-8999-999999999999",
        thread_id: "task:renaissance",
        scope: { base_revision: null, branch: null, paths: ["packages/sdk-ts"] },
        expires_at: "2026-07-20T13:00:00.000Z",
        conflicted: true,
        competing_event_ids: [PARENT_ID],
      },
    ];
    mockFetch = mock(() => Promise.resolve(response(200, {
      protocol: CORRESPONDENCE_PROTOCOL,
      scope: "project_private",
      evaluated_at: "2026-07-19T12:40:00.000Z",
      cursor: "44",
      projection_status: "complete",
      truncated: false,
      claims,
    })));
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const result = await client().correspondence.activeClaims({
      repository_id: "cambridgetcg/agenttool",
      path: "packages/sdk-ts",
    });
    expect(result.claims).toEqual(claims);
    expect(result.claims.map((claim) => claim.generation)).toEqual([2, 4]);
    expect((mockFetch.mock.calls[0]?.[1] as RequestInit).cache).toBe("no-store");
    expect(String(mockFetch.mock.calls[0]?.[0])).toContain("path=packages%2Fsdk-ts");
  });

  test("voice is one finite JSON snapshot and preserves every conflict class", async () => {
    const recent = record(signedEvent(), "44");
    const snapshot = {
      protocol: CORRESPONDENCE_PROTOCOL,
      scope: "project_private",
      evaluated_at: "2026-07-19T12:40:00.000Z",
      cursor: "44",
      projection_status: "truncated",
      truncated: true,
      recent_events: [recent],
      active_claims: [],
      conflicts: {
        missing_parents: [{ event_id: recent.event.event_id, missing_parent_ids: [PARENT_ID] }],
        session_forks: [{
          identity_id: IDENTITY_ID,
          device_id: DEVICE_ID,
          session_id: SESSION_ID,
          session_seq: 7,
          event_ids: [PARENT_ID, SECOND_PARENT_ID],
        }],
        overlapping_claims: [{
          left_event_id: PARENT_ID,
          right_event_id: SECOND_PARENT_ID,
          paths: ["packages/sdk-ts"],
        }],
      },
    } as const;
    mockFetch = mock(() => Promise.resolve(response(200, snapshot)));
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const result = await client().correspondence.voice({
      repository_id: "cambridgetcg/agenttool",
      thread_id: "task:renaissance",
    });
    expect(result).toEqual(snapshot);
    expect(result.projection_status).toBe("truncated");
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/v1/correspondence/voice?");
    expect(init.headers && new Headers(init.headers).get("Accept")).toBe("application/json");
    expect(init.cache).toBe("no-store");
  });

  test("preserves guided error metadata", async () => {
    mockFetch = mock(() => Promise.resolve(response(409, {
      error: "correspondence_session_fork",
      message: "That session sequence already names a different event.",
      hint: "Advance session_seq without erasing either event.",
      details: { session_seq: 7 },
    })));
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    try {
      await client().correspondence.append({
        ...unsigned(), signing_key: SIGNING_KEY,
      } as CorrespondenceAppendOptions);
      throw new Error("expected append to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(AgentToolError);
      expect(error).toMatchObject({
        code: "correspondence_session_fork",
        status: 409,
        details: { session_seq: 7 },
      });
    }
  });
});
