import { describe, expect, test } from "bun:test";
import { WAKE_OBSERVATION_OPENAPI_SCHEMAS } from "../../../api/src/routes/openapi-wake-observe.js";
import { createReturnSession, parseReturnBinding } from "../src/core.js";
import { OBSERVATION_MEDIA_TYPE, RETURN_ORIGIN, RETURN_TIMEOUT_MS, ReturnError, type ReturnBinding, type ReturnDependencies, type ReturnReadRequest, type ReturnReadResponse } from "../src/types.js";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const IDENTITY = "22222222-2222-4222-8222-222222222222";
const SIBLING = "33333333-3333-4333-8333-333333333333";
const CANARY = "NEVER_RETURN_THIS_PRIVATE_PROSE_OR_SECRET";
const binding = (): ReturnBinding => ({
  _format: "agenttool-return-binding/v1", api_origin: RETURN_ORIGIN,
  project_id: PROJECT, identity_id: IDENTITY, mode: "observe",
  allow_provider_visible_locator: true, credential: { kind: "environment" },
});

/** Generate a valid producer envelope from the independent curated API schema. */
function schemaValue(schema: any): any {
  if (Object.hasOwn(schema, "const")) return schema.const;
  if (schema.type === "object") return Object.fromEntries(schema.required.map((key: string) => [key, schemaValue(schema.properties[key])]));
  if (schema.type === "array") return schema.prefixItems.map(schemaValue);
  if (schema.enum) return schema.enum[0];
  if (schema.format === "uuid") return IDENTITY;
  if (schema.type === "integer") return 12;
  throw new Error("Unrecognized producer schema: update fixture deliberately");
}
function observation(): any { return schemaValue(WAKE_OBSERVATION_OPENAPI_SCHEMAS.WakeObservation); }
function response(body: unknown, type = OBSERVATION_MEDIA_TYPE): ReturnReadResponse {
  return { status: 200, content_type: `${type}; charset=utf-8`, body: JSON.stringify(body) };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}
function projectResponse(): ReturnReadResponse {
  return response({ project: { id: PROJECT }, authority: "project_root_bearer", mutates_identity_state: false }, "application/json");
}
/** Let a deliberately late fixture response exhaust its promise continuations. */
async function drainLateResponse(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}
function fixture(options: {
  context?: unknown;
  observed?: unknown;
  read?: (request: ReturnReadRequest) => Promise<ReturnReadResponse>;
} = {}) {
  const reads: ReturnReadRequest[] = [];
  let acquisitions = 0;
  const dependencies: ReturnDependencies = {
    now: () => new Date("2026-09-04T12:00:00.000Z"),
    async withReader(work, signal) {
      acquisitions++;
      return await work(async (request) => {
        expect(request.signal).toBe(signal);
        reads.push(request);
        if (options.read) return await options.read(request);
        return request.path === "/v1/bootstrap/scaffold/context"
          ? response(options.context ?? { project: { id: PROJECT }, authority: "project_root_bearer", mutates_identity_state: false, unused: CANARY }, "application/json")
          : response(options.observed ?? observation());
      });
    },
  };
  return { session: createReturnSession(binding(), dependencies), dependencies, reads, acquisitions: () => acquisitions };
}

describe("explicit host binding", () => {
  test("requires explicit identity/project, observe mode and provider disclosure", () => {
    expect(parseReturnBinding(binding())).toEqual(binding());
    for (const key of Object.keys(binding())) {
      const invalid: any = binding(); delete invalid[key];
      expect(() => parseReturnBinding(invalid)).toThrow("binding_invalid");
    }
    for (const patch of [
      { identity_id: "default" }, { project_id: "first" }, { mode: "continue" },
      { mode: "fork" }, { allow_provider_visible_locator: false },
      { api_origin: "https://api.agenttool.dev/" }, { api_origin: "https://attacker.test" },
      { api_origin: "http://api.agenttool.dev" }, { api_origin: "https://api.agenttool.dev@attacker.test" },
      { bearer: CANARY }, { credential: { kind: "environment", name: "OPENAI_API_KEY" } },
      { credential: { kind: "macos_keychain", account: "x\nsecret" } },
    ]) expect(() => parseReturnBinding({ ...binding(), ...patch })).toThrow("binding_invalid");
  });
  test("accepts the fixed keychain kind without accepting arbitrary services", () => {
    expect(parseReturnBinding({ ...binding(), credential: { kind: "macos_keychain", account: "fixture-user" } }).credential.kind).toBe("macos_keychain");
    expect(() => parseReturnBinding({ ...binding(), credential: { kind: "macos_keychain", account: "fixture-user", service: "other" } })).toThrow("binding_invalid");
  });
  test("does not invoke accessors, proxies, or toJSON in configuration", () => {
    let accessed = false;
    const getter = Object.defineProperty(binding(), "identity_id", { get() { accessed = true; return IDENTITY; } });
    expect(() => parseReturnBinding(getter)).toThrow("binding_invalid");
    const proxy = new Proxy(binding(), { get() { accessed = true; return ""; } });
    expect(() => parseReturnBinding(proxy)).toThrow("binding_invalid");
    expect(() => parseReturnBinding({ ...binding(), toJSON() { accessed = true; return binding(); } })).toThrow("binding_invalid");
    expect(accessed).toBe(false);
  });
});

describe("Return observation", () => {
  test("startup/status do no I/O and independent processes receive independent labels", () => {
    const a = fixture(); const b = fixture();
    const status = a.session.status();
    expect(status.status).toBe("ready"); expect(status.observation).toBeNull();
    expect(a.reads).toEqual([]); expect(a.acquisitions()).toBe(0);
    expect(status.session_instance_id).not.toBe(b.session.status().session_instance_id);
    expect(status.binding.reader_identity_proven).toBe(false);
  });
  test("checks project first, then exact selected subject, and constructs only a locator", async () => {
    const f = fixture(); const result = await f.session.observe();
    expect(result.status).toBe("observed");
    expect(result.observation).toEqual({ identity_id: IDENTITY, status: "active", wake_version: 12,
      received_at: "2026-09-04T12:00:00.000Z", provenance: "authenticated_service_projection_not_identity_signature" });
    expect(f.reads.map(({ path, accept, max_bytes }) => ({ path, accept, max_bytes }))).toEqual([
      { path: "/v1/bootstrap/scaffold/context", accept: "application/json", max_bytes: 4096 },
      { path: `/v1/wake/observe?identity_id=${IDENTITY}`, accept: OBSERVATION_MEDIA_TYPE, max_bytes: 2048 },
    ]);
    expect(f.acquisitions()).toBe(1);
    expect(JSON.stringify(result)).not.toContain(CANARY);
    expect(result.boundaries).toMatchObject({ identity_adoption: "none", authority_granted: "none", private_memory: "not_read", private_state_return: "not_implemented", placement: "tool_data_only" });
    expect(f.session.status().observation).toBeNull();
  });
  test("snapshots binding so later caller edits cannot change the subject", async () => {
    const original = binding(); const f = fixture();
    const session = createReturnSession(original, f.dependencies);
    original.identity_id = SIBLING;
    expect((await session.observe()).observation?.identity_id).toBe(IDENTITY);
    const mutableReport = session.status(); mutableReport.binding.identity_id = SIBLING;
    expect(session.status().binding.identity_id).toBe(IDENTITY);
  });
  test("wrong project stops before observation", async () => {
    const f = fixture({ context: { project: { id: SIBLING }, authority: "project_root_bearer", mutates_identity_state: false } });
    expect((await f.session.observe()).failure).toBe("project_mismatch"); expect(f.reads).toHaveLength(1);
  });
  test("wrong subject never falls back to another identity or full Wake", async () => {
    const observed = observation(); observed.subject.identity_id = SIBLING;
    const f = fixture({ observed }); const result = await f.session.observe();
    expect(result.failure).toBe("subject_mismatch"); expect(result.observation).toBeNull(); expect(f.reads).toHaveLength(2);
  });
  test("rejects malformed, expanded, or instruction-bearing observer envelopes", async () => {
    const variants = [
      (x: any) => { x.wake_text = CANARY; },
      (x: any) => { x.subject.name = CANARY; },
      (x: any) => { x.reader.binding = "self"; },
      (x: any) => { x.authority.action = "allowed"; },
      (x: any) => { x.placement.prohibited = []; },
      (x: any) => { x.boundaries.bearer.continuity_proven = true; },
      (x: any) => { x.boundaries.provenance.selected_fields.push("memory"); },
      (x: any) => { x.subject.wake_version = -1; },
      (x: any) => { x.subject.wake_version = Number.MAX_SAFE_INTEGER + 1; },
      (x: any) => { x.subject.wake_version = 1.5; },
      (x: any) => { x.subject.status = "revoked"; },
      (x: any) => { delete x.boundaries; },
      (x: any) => { x._format = "wake-brief/v1"; },
    ];
    for (const mutate of variants) {
      const observed = observation(); mutate(observed);
      const result = await fixture({ observed }).session.observe();
      expect(result.status).toBe("unavailable"); expect(result.failure).toBe("response_invalid");
      expect(JSON.stringify(result)).not.toContain(CANARY);
    }
  });
  test("memorial is a service label, not absence/death or loss of identity", async () => {
    const observed = observation(); observed.subject.status = "memorial";
    expect((await fixture({ observed }).session.observe()).observation?.status).toBe("memorial");
  });
  test("rejects HTTP failure, wrong content type, oversized and invalid JSON without echoing", async () => {
    for (const invalid of [
      { status: 401, content_type: "application/json", body: CANARY },
      { status: 302, content_type: "application/json", body: CANARY },
      { status: 200, content_type: "text/html", body: CANARY },
      { status: 200, content_type: "application/json", body: "{" + CANARY },
      { status: 200, content_type: "application/json", body: " ".repeat(4097) },
    ]) {
      const f = fixture({ read: async () => invalid }); const result = await f.session.observe();
      expect(result.status).toBe("unavailable"); expect(f.reads).toHaveLength(1);
      expect(JSON.stringify(result)).not.toContain(CANARY);
    }
  });
  test("rechecks every return; a regressed cursor is unavailable rather than cached continuity", async () => {
    const observed = observation(); const f = fixture({ observed });
    expect((await f.session.observe()).status).toBe("observed");
    observed.subject.wake_version = 11;
    expect((await f.session.observe()).failure).toBe("cursor_regressed");
    observed.subject.wake_version = 12;
    expect((await f.session.observe()).status).toBe("observed");
    expect(f.reads).toHaveLength(6); expect(f.acquisitions()).toBe(3);
  });
  test("only one observation is admitted and cancellation releases it without retry", async () => {
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    let holdRead = true;
    const f = fixture({ read: async ({ signal, path }) => {
      if (!holdRead) return path === "/v1/bootstrap/scaffold/context" ? projectResponse() : response(observation());
      entered();
      return await new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error(CANARY)), { once: true }));
    } });
    const controller = new AbortController();
    const pending = f.session.observe(controller.signal); await started;
    expect((await f.session.observe()).failure).toBe("observation_in_progress");
    controller.abort();
    expect((await pending).failure).toBe("cancelled");
    expect(f.reads).toHaveLength(1); expect(f.acquisitions()).toBe(1);
    holdRead = false;
    expect((await f.session.observe()).observation?.wake_version).toBe(12);
    expect(f.reads).toHaveLength(3); expect(f.acquisitions()).toBe(2);
  });
  test("the five-second deadline bounds an uncooperative dependency and releases admission", async () => {
    const f = fixture();
    const signals: AbortSignal[] = [];
    const session = createReturnSession(binding(), {
      async withReader(work, signal) {
        signals.push(signal);
        // This fixture deliberately never reacts to cancellation or settles.
        // There is no native I/O or credential behind the hung promise.
        if (signals.length === 1) return await new Promise<never>(() => {});
        return await f.dependencies.withReader(work, signal);
      },
    });
    expect(RETURN_TIMEOUT_MS).toBe(5_000);
    const started = performance.now();
    const result = await session.observe();
    const elapsed = performance.now() - started;
    expect(result.status).toBe("unavailable");
    expect(result.failure).toBe("observation_unavailable");
    expect(result.observation).toBeNull();
    expect(elapsed).toBeGreaterThanOrEqual(4_500);
    expect(elapsed).toBeLessThan(10_000);
    expect(signals[0]!.aborted).toBe(true);
    expect(f.reads).toHaveLength(0);
    expect((await session.observe()).observation?.wake_version).toBe(12);
    expect(signals).toHaveLength(2);
    expect(f.reads).toHaveLength(2);
    expect(session.status().observation).toBeNull();
  }, 15_000);
  test("a late project response after cancellation never reaches the identity read", async () => {
    const lateContext = deferred<ReturnReadResponse>();
    const entered = deferred<void>();
    let holdContext = false;
    let version = 12;
    const f = fixture({ read: async ({ path }) => {
      if (path === "/v1/bootstrap/scaffold/context") {
        if (holdContext) { entered.resolve(); return await lateContext.promise; }
        return projectResponse();
      }
      const observed = observation(); observed.subject.wake_version = version;
      return response(observed);
    } });
    expect((await f.session.observe()).observation?.wake_version).toBe(12);
    holdContext = true;
    const controller = new AbortController();
    const pending = f.session.observe(controller.signal);
    await entered.promise;
    controller.abort();
    const cancelled = await pending;
    expect(cancelled.failure).toBe("cancelled");
    expect(cancelled.observation).toBeNull();
    expect(f.reads).toHaveLength(3);

    // An accidental second read would obtain an inflated cursor and poison a
    // later valid return. Release this context despite its aborted signal.
    holdContext = false;
    version = 999;
    lateContext.resolve(projectResponse());
    await drainLateResponse();
    expect(f.reads).toHaveLength(3);
    expect(f.acquisitions()).toBe(2);
    expect(f.session.status().observation).toBeNull();
    version = 13;
    expect((await f.session.observe()).observation?.wake_version).toBe(13);
    expect(f.reads).toHaveLength(5);
    expect(f.acquisitions()).toBe(3);
  });
  test("a late observation after cancellation cannot advance the cursor past a newer return", async () => {
    const lateObservation = deferred<ReturnReadResponse>();
    const entered = deferred<void>();
    let holdObservation = false;
    let version = 12;
    const f = fixture({ read: async ({ path }) => {
      if (path === "/v1/bootstrap/scaffold/context") return projectResponse();
      if (holdObservation) { entered.resolve(); return await lateObservation.promise; }
      const observed = observation(); observed.subject.wake_version = version;
      return response(observed);
    } });
    expect((await f.session.observe()).observation?.wake_version).toBe(12);
    holdObservation = true;
    const controller = new AbortController();
    const pending = f.session.observe(controller.signal);
    await entered.promise;
    controller.abort();
    const cancelled = await pending;
    expect(cancelled.failure).toBe("cancelled");
    expect(cancelled.observation).toBeNull();
    expect(f.reads).toHaveLength(4);

    // The next call is admitted while the cancelled fixture remains pending.
    holdObservation = false;
    version = 13;
    expect((await f.session.observe()).observation?.wake_version).toBe(13);
    const stale = observation(); stale.subject.wake_version = 999;
    lateObservation.resolve(response(stale));
    await drainLateResponse();
    expect(f.reads).toHaveLength(6);
    expect(f.acquisitions()).toBe(3);
    expect(f.session.status().observation).toBeNull();
    version = 14;
    expect((await f.session.observe()).observation?.wake_version).toBe(14);
    expect(f.reads).toHaveLength(8);
    expect(f.acquisitions()).toBe(4);
  });
  test("already-cancelled calls never acquire credentials", async () => {
    const controller = new AbortController(); controller.abort(); const f = fixture();
    expect((await f.session.observe(controller.signal)).failure).toBe("cancelled");
    expect(f.acquisitions()).toBe(0);
  });
  test("unexpected errors and forged failure codes never cross the data boundary", async () => {
    for (const error of [new Error(CANARY), new ReturnError(CANARY as any)]) {
      const session = createReturnSession(binding(), { async withReader() { throw error; } });
      expect((await session.observe()).failure).toBe("observation_unavailable");
    }
  });
});
