import { afterEach, describe, expect, test } from "bun:test";
import { type spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import type { ClientRequest, IncomingMessage } from "node:http";
import type { RequestOptions } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { WAKE_OBSERVATION_OPENAPI_SCHEMAS } from "../../../api/src/routes/openapi-wake-observe.js";
import { createReturnSession } from "../src/core.js";
import {
  checkReturnScaffold, createReturnHostDependencies, executeReturnKeychain, loadReturnHost,
  type ReturnHostSeams,
} from "../src/host.js";
import {
  OBSERVATION_MEDIA_TYPE, RETURN_ORIGIN, ReturnError,
  type ReturnBinding, type ReturnFailure, type ReturnReadRequest, type ReturnReadResponse,
} from "../src/types.js";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const IDENTITY = "22222222-2222-4222-8222-222222222222";
const TOKEN = "test-only-never-a-real-bearer";
const CONTEXT = "/v1/bootstrap/scaffold/context";
const OBSERVE = `/v1/wake/observe?identity_id=${IDENTITY}`;
const directories: string[] = [];

afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});

function binding(credential: ReturnBinding["credential"] = { kind: "environment" }): ReturnBinding {
  return {
    _format: "agenttool-return-binding/v1", api_origin: RETURN_ORIGIN,
    project_id: PROJECT, identity_id: IDENTITY, mode: "observe",
    allow_provider_visible_locator: true, credential,
  };
}

/** Independent producer contract, not a copy of the consumer's allowlist. */
function schemaValue(schema: any): any {
  if (Object.hasOwn(schema, "const")) return schema.const;
  if (schema.type === "object") return Object.fromEntries(schema.required.map((key: string) => [key, schemaValue(schema.properties[key])]));
  if (schema.type === "array") return schema.prefixItems.map(schemaValue);
  if (schema.enum) return schema.enum[0];
  if (schema.format === "uuid") return IDENTITY;
  if (schema.type === "integer") return 12;
  throw new Error("Unrecognized producer schema: update fixture deliberately");
}

function projectReply(projectId = PROJECT): Reply {
  return { body: JSON.stringify({ project: { id: projectId }, authority: "project_root_bearer", mutates_identity_state: false, ignored_metadata: "DO_NOT_PROJECT_THIS_PROSE" }) };
}

function observationReply(identityId = IDENTITY): Reply {
  const body = schemaValue(WAKE_OBSERVATION_OPENAPI_SCHEMAS.WakeObservation);
  body.subject.identity_id = identityId;
  return { headers: { "content-type": `${OBSERVATION_MEDIA_TYPE}; charset=utf-8` }, body: JSON.stringify(body) };
}

function temporary(): string {
  const path = mkdtempSync(join(tmpdir(), "agenttool-return-host-"));
  directories.push(path);
  return path;
}

function config(directory: string, name: string, value: unknown): string {
  const path = join(directory, name);
  writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
  return path;
}

function request(signal = new AbortController().signal, path = CONTEXT): ReturnReadRequest {
  return { path, signal, accept: path === CONTEXT ? "application/json" : OBSERVATION_MEDIA_TYPE, max_bytes: path === CONTEXT ? 4096 : 2048 };
}

interface Reply {
  status?: number;
  headers?: Record<string, string | string[]>;
  body?: string | Buffer;
  chunks?: Buffer[];
  hang?: boolean;
  error?: string;
  abort?: boolean;
}

/** Native HTTPS-shaped in-memory seam. It never opens a socket. */
function httpsFixture(replies: Reply[]) {
  const calls: RequestOptions[] = [];
  const outgoing: Array<EventEmitter & { destroyed: boolean }> = [];
  const responses: PassThrough[] = [];
  const send: NonNullable<ReturnHostSeams["request"]> = (options, receive) => {
    calls.push(options);
    const reply = replies[calls.length - 1] ?? { error: "unexpected fixture request" };
    const socket = Object.assign(new EventEmitter(), {
      destroyed: false,
      destroy() { this.destroyed = true; return this; },
      end() {
        queueMicrotask(() => {
          if (socket.destroyed) return;
          if (reply.error) return void socket.emit("error", new Error(reply.error));
          if (reply.hang && !reply.headers) return;
          const response = Object.assign(new PassThrough(), {
            statusCode: reply.status ?? 200,
            headers: reply.headers ?? { "content-type": "application/json" },
          });
          responses.push(response);
          receive(response as unknown as IncomingMessage);
          if (response.destroyed) return;
          if (reply.abort) {
            response.emit("aborted");
            return;
          }
          if (reply.hang) return;
          for (const chunk of reply.chunks ?? []) response.write(chunk);
          response.end(reply.body ?? "{}");
        });
        return this;
      },
    });
    outgoing.push(socket);
    return socket as unknown as ClientRequest;
  };
  return { request: send, calls, outgoing, responses };
}

async function oneReply(reply: Reply, max_bytes = 4096): Promise<ReturnReadResponse> {
  const fake = httpsFixture([reply]);
  const dependencies = createReturnHostDependencies(binding(), { environment: () => TOKEN, request: fake.request });
  return dependencies.withReader((read) => read({ ...request(), max_bytes }), new AbortController().signal);
}

async function errorCode(operation: Promise<unknown>, expected: ReturnFailure): Promise<void> {
  try {
    await operation;
    throw new Error("expected rejection");
  } catch (error) {
    expect(error).toBeInstanceOf(ReturnError);
    expect((error as ReturnError).code).toBe(expected);
    expect((error as Error).message).toBe(expected);
    expect(String(error)).not.toContain(TOKEN);
  }
}

describe("explicit local binding and optional scaffold", () => {
  test("loads selected bounded owner-only JSON without modifying either file", async () => {
    const directory = temporary();
    const path = config(directory, "binding.json", binding());
    const scaffold = config(directory, "agent.json", {
      identity_id: IDENTITY, wake_url: `${RETURN_ORIGIN}/v1/wake?identity_id=${IDENTITY}`,
      name: "ignored", did: "ignored", key_source: { file: "/must/not/read" },
    });
    const before = [readFileSync(path), readFileSync(scaffold)];
    const loaded = await loadReturnHost(path, scaffold);
    expect(loaded.binding).toEqual(binding());
    expect(typeof loaded.dependencies.withReader).toBe("function");
    expect([readFileSync(path), readFileSync(scaffold)]).toEqual(before);
  });

  test("scaffold cannot choose an identity or change the origin, query, or route", async () => {
    const directory = temporary();
    const path = config(directory, "binding.json", binding());
    for (const candidate of [
      { identity_id: PROJECT, wake_url: `${RETURN_ORIGIN}/v1/wake?identity_id=${IDENTITY}` },
      { identity_id: IDENTITY, wake_url: `https://other.invalid/v1/wake?identity_id=${IDENTITY}` },
      { identity_id: IDENTITY, wake_url: `${RETURN_ORIGIN}/v1/wake?identity_id=${IDENTITY}&format=md` },
      { identity_id: IDENTITY, wake_url: `${RETURN_ORIGIN}/v1/wake/observe?identity_id=${IDENTITY}` },
      { identity_id: IDENTITY }, null,
    ]) {
      const scaffold = config(directory, "agent.json", candidate);
      await errorCode(loadReturnHost(path, scaffold), "scaffold_mismatch");
    }
    const noConsent = config(directory, "invalid.json", { ...binding(), allow_provider_visible_locator: false });
    await errorCode(loadReturnHost(noConsent), "binding_invalid");
  });

  test("does not inspect persona or credential-source fields", () => {
    const scaffold = {
      identity_id: IDENTITY, wake_url: `${RETURN_ORIGIN}/v1/wake?identity_id=${IDENTITY}`,
      get name() { throw new Error("must not read name"); },
      get did() { throw new Error("must not read DID"); },
      get key_source() { throw new Error("must not read key source"); },
    };
    expect(() => checkReturnScaffold(scaffold, binding())).not.toThrow();
  });

  test("rejects symlink final components, directories, oversized, malformed and missing files", async () => {
    const directory = temporary();
    const path = config(directory, "binding.json", binding());
    const symlink = join(directory, "link.json");
    symlinkSync(path, symlink);
    const huge = join(directory, "huge.json");
    writeFileSync(huge, " ".repeat(16_385), { mode: 0o600 });
    const invalid = join(directory, "invalid.json");
    writeFileSync(invalid, Buffer.from([0xff]), { mode: 0o600 });
    for (const candidate of [symlink, directory, huge, invalid, join(directory, "missing"), "", "binding.json"]) {
      await errorCode(loadReturnHost(candidate), "binding_invalid");
    }
    await errorCode(loadReturnHost(path, symlink), "scaffold_mismatch");
  });

  test.skipIf(process.platform === "win32")("rejects every group/world permission bit but permits stricter owner-only mode", async () => {
    const directory = temporary();
    const path = config(directory, "binding.json", binding());
    for (const permission of [0o640, 0o620, 0o610, 0o604, 0o602, 0o601]) {
      chmodSync(path, permission);
      await errorCode(loadReturnHost(path), "binding_invalid");
    }
    chmodSync(path, 0o400);
    expect((await loadReturnHost(path)).binding.identity_id).toBe(IDENTITY);
  });

  test("ancestor trust is explicit: no claim of rejecting ancestor symlinks", async () => {
    const directory = temporary();
    const real = join(directory, "real");
    mkdirSync(real, { mode: 0o700 });
    config(real, "binding.json", binding());
    const linked = join(directory, "linked");
    symlinkSync(real, linked);
    expect((await loadReturnHost(join(linked, "binding.json"))).binding).toEqual(binding());
  });
});

describe("lazy credential lifetime", () => {
  test("status acquires nothing; each explicit read scope uses only the fixed environment name", async () => {
    const names: string[] = [];
    const fake = httpsFixture([{}, {}]);
    const dependencies = createReturnHostDependencies(binding(), {
      environment: (name) => { names.push(name); return TOKEN; }, request: fake.request,
    });
    createReturnSession(binding(), dependencies).status();
    expect(names).toEqual([]);
    expect(fake.calls).toEqual([]);
    for (let i = 0; i < 2; i++) await dependencies.withReader((read) => read(request()), new AbortController().signal);
    expect(names).toEqual(["AGENTTOOL_RETURN_BEARER", "AGENTTOOL_RETURN_BEARER"]);
    expect(fake.calls).toHaveLength(2);
  });

  test("rejects empty, multiline, whitespace, non-ASCII and oversized credentials without I/O", async () => {
    for (const value of [undefined, "", "a b", "a\tb", "a\nb", "a\rb", "é", "a".repeat(4097)]) {
      const fake = httpsFixture([]);
      const dependencies = createReturnHostDependencies(binding(), { environment: () => value, request: fake.request });
      await errorCode(dependencies.withReader((read) => read(request()), new AbortController().signal), "credential_unavailable");
      expect(fake.calls).toEqual([]);
    }
  });

  test("Keychain uses project-derived service and explicit account, with no environment fallback", async () => {
    const calls: unknown[] = [];
    const fake = httpsFixture([{}]);
    const selected = binding({ kind: "macos_keychain", account: "local-test-account" });
    const dependencies = createReturnHostDependencies(selected, {
      platform: "darwin", environment: () => { throw new Error("must not inspect environment"); },
      executeKeychain: async (service, account, signal) => { calls.push([service, account, signal.aborted]); return TOKEN; },
      request: fake.request,
    });
    expect(calls).toEqual([]);
    await dependencies.withReader((read) => read(request()), new AbortController().signal);
    expect(calls).toEqual([[`agenttool:${createHash("sha256").update(PROJECT).digest("hex").slice(0, 16)}`, "local-test-account", false]]);
    const unsupported = createReturnHostDependencies(selected, {
      platform: "linux", executeKeychain: async () => { throw new Error("must not execute"); },
    });
    await errorCode(unsupported.withReader(async () => null, new AbortController().signal), "credential_unavailable");
  });

  test("pre-aborted scopes do not retrieve credentials", async () => {
    const controller = new AbortController();
    controller.abort(TOKEN);
    const dependencies = createReturnHostDependencies(binding(), { environment: () => { throw new Error("must not inspect"); } });
    await errorCode(dependencies.withReader(async () => null, controller.signal), "cancelled");
  });

  test("deadline bounds a stalled credential executor and aborts it", async () => {
    let signal: AbortSignal | undefined;
    const dependencies = createReturnHostDependencies(binding({ kind: "macos_keychain", account: "test" }), {
      platform: "darwin", timeoutMs: 15,
      executeKeychain: async (_service, _account, selectedSignal) => {
        signal = selectedSignal;
        return new Promise<string>(() => {});
      },
    });
    await errorCode(dependencies.withReader(async () => null, new AbortController().signal), "transport_unavailable");
    expect(signal?.aborted).toBe(true);
  });

  test("executor/environment/callback errors never reflect original text or arbitrary ReturnError codes", async () => {
    const env = createReturnHostDependencies(binding(), { environment: () => { throw new Error(TOKEN); } });
    await errorCode(env.withReader(async () => null, new AbortController().signal), "credential_unavailable");
    const deps = createReturnHostDependencies(binding(), { environment: () => TOKEN });
    await errorCode(deps.withReader(async () => { throw new Error(TOKEN); }, new AbortController().signal), "response_invalid");
    await errorCode(deps.withReader(async () => { throw new ReturnError(TOKEN as "response_invalid"); }, new AbortController().signal), "response_invalid");
  });
});

describe("bounded fixed-origin HTTPS reader", () => {
  test("uses exactly two sequential fixed GETs, no proxy agent, redirects, cookies or retry", async () => {
    const fake = httpsFixture([{}, { headers: { "content-type": OBSERVATION_MEDIA_TYPE } }]);
    const original = binding();
    const dependencies = createReturnHostDependencies(original, { environment: () => TOKEN, request: fake.request });
    original.identity_id = PROJECT;
    await dependencies.withReader(async (read) => {
      expect((await read(request())).body).toBe("{}");
      expect((await read(request(undefined, OBSERVE))).content_type).toBe(OBSERVATION_MEDIA_TYPE);
    }, new AbortController().signal);
    expect(fake.calls.map((call) => call.path)).toEqual([CONTEXT, OBSERVE]);
    for (const call of fake.calls) {
      expect(call).toEqual({
        protocol: "https:", hostname: "api.agenttool.dev", port: 443, method: "GET",
        path: call.path, agent: false, rejectUnauthorized: true, maxHeaderSize: 4096,
        headers: { Authorization: `Bearer ${TOKEN}`, Accept: call.path === CONTEXT ? "application/json" : OBSERVATION_MEDIA_TYPE, "Accept-Encoding": "identity", "Cache-Control": "no-store" },
      });
    }
    expect(fake.outgoing.every((socket) => socket.destroyed)).toBe(true);
    expect(fake.responses.every((response) => response.destroyed)).toBe(true);
  });

  test("rejects arbitrary paths, observation-first, media injection and oversized bounds", async () => {
    for (const changed of [
      { path: "https://elsewhere.invalid/" }, { path: OBSERVE }, { path: `${CONTEXT}?extra=1` },
      { path: "/v1/wake?format=md" }, { accept: "application/json\r\nCookie: bad" },
      { max_bytes: 4097 }, { max_bytes: 0 }, { max_bytes: 1.5 },
    ]) {
      const fake = httpsFixture([]);
      const dependencies = createReturnHostDependencies(binding(), { environment: () => TOKEN, request: fake.request });
      await errorCode(dependencies.withReader((read) => read({ ...request(), ...changed }), new AbortController().signal), "response_invalid");
      expect(fake.calls).toEqual([]);
    }
  });

  test("does not permit repeated, concurrent, or escaped readers", async () => {
    const fake = httpsFixture([{}]);
    const dependencies = createReturnHostDependencies(binding(), { environment: () => TOKEN, request: fake.request });
    let escaped: ((input: ReturnReadRequest) => Promise<ReturnReadResponse>) | undefined;
    await dependencies.withReader(async (read) => {
      escaped = read;
      const pending = read(request());
      await errorCode(read(request(undefined, OBSERVE)), "response_invalid");
      await pending;
      await errorCode(read(request()), "response_invalid");
    }, new AbortController().signal);
    await errorCode(escaped!(request(undefined, OBSERVE)), "cancelled");
    expect(fake.calls).toHaveLength(1);
  });

  test("non-200 error/redirect bodies and headers are discarded without following Location", async () => {
    for (const status of [301, 302, 307, 308, 401, 403, 429, 500]) {
      const result = await oneReply({ status, headers: { "content-type": TOKEN, location: "https://elsewhere.invalid", "set-cookie": TOKEN }, body: TOKEN });
      expect(result).toEqual({ status, content_type: "", body: "" });
    }
  });

  test("accepts exact bounded JSON and canonicalizes the narrow content type", async () => {
    expect(await oneReply({ headers: { "content-type": "application/json; charset=utf-8", "content-length": "2" }, body: "{}" }, 2))
      .toEqual({ status: 200, content_type: "application/json", body: "{}" });
  });

  test("rejects compression, malformed media/length, oversized streams, truncation and invalid UTF-8/JSON", async () => {
    const replies: Reply[] = [
      { headers: { "content-type": "application/json", "content-encoding": "gzip" } },
      { headers: { "content-type": "text/plain" } },
      { headers: { "content-type": ["application/json", "application/json"] } },
      { headers: { "content-type": "application/json", "content-length": "4097" } },
      { headers: { "content-type": "application/json", "content-length": "NaN" } },
      { headers: { "content-type": "application/json", "content-length": "-1" } },
      { headers: { "content-type": "application/json", "content-length": "3" }, body: "{}" },
      { body: "x".repeat(4097) },
      { chunks: [Buffer.alloc(3000, 32), Buffer.alloc(2000, 32)] },
      { body: "not-json" }, { body: Buffer.from([0xff]) },
    ];
    for (const reply of replies) await errorCode(oneReply(reply), "response_invalid");
    await errorCode(oneReply({ abort: true }), "transport_unavailable");
    await errorCode(oneReply({ error: TOKEN }), "transport_unavailable");
  });

  test("rejects exact and JSON-escaped credential echoes in keys or nested values", async () => {
    const escaped = [...TOKEN].map((letter) => `\\u${letter.charCodeAt(0).toString(16).padStart(4, "0")}`).join("");
    for (const body of [JSON.stringify({ note: TOKEN }), JSON.stringify({ [TOKEN]: true }), `{"note":[{"value":"${escaped}"}]}`]) {
      await errorCode(oneReply({ body }), "response_invalid");
    }
  });

  test("one deadline covers credential lookup and transport; sockets are destroyed on timeout", async () => {
    const fake = httpsFixture([{ hang: true, headers: { "content-type": "application/json" } }]);
    const dependencies = createReturnHostDependencies(binding(), { environment: () => TOKEN, request: fake.request, timeoutMs: 15 });
    await errorCode(dependencies.withReader((read) => read(request()), new AbortController().signal), "transport_unavailable");
    expect(fake.outgoing[0]?.destroyed).toBe(true);
    expect(fake.responses[0]?.destroyed).toBe(true);
  });

  test("caller and individual request cancellation settle a stalled read without echoing abort reason", async () => {
    for (const useRequestSignal of [false, true]) {
      const fake = httpsFixture([{ hang: true }]);
      const controller = new AbortController();
      const dependencies = createReturnHostDependencies(binding(), { environment: () => TOKEN, request: fake.request });
      const result = dependencies.withReader((read) => read(request(useRequestSignal ? controller.signal : undefined)), useRequestSignal ? new AbortController().signal : controller.signal);
      queueMicrotask(() => controller.abort(TOKEN));
      await errorCode(result, "cancelled");
      expect(fake.outgoing.every((socket) => socket.destroyed)).toBe(true);
    }
  });
});

describe("fixed Keychain subprocess", () => {
  function childFixture() {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(), stderr: new PassThrough(),
      killed: false,
      kill(signal: string) { this.killed = signal === "SIGKILL"; return true; },
    });
    const calls: unknown[][] = [];
    const fakeSpawn = ((...args: unknown[]) => { calls.push(args); return child; }) as unknown as typeof spawn;
    return { child, calls, spawn: fakeSpawn };
  }

  test("uses fixed executable/argv without a shell or inherited environment", async () => {
    const fake = childFixture();
    const promise = executeReturnKeychain("agenttool:0123456789abcdef", "test-account", new AbortController().signal, fake.spawn);
    fake.child.stdout.write(`${TOKEN}\n`);
    fake.child.emit("close", 0);
    expect(await promise).toBe(TOKEN);
    expect(fake.calls).toEqual([["/usr/bin/security", ["find-generic-password", "-s", "agenttool:0123456789abcdef", "-a", "test-account", "-w"], {
      shell: false, env: {}, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    }]]);
    expect(JSON.stringify(fake.calls)).not.toContain(TOKEN);
  });

  test("kills on cancellation and rejects output/error overflow without reporting its bytes", async () => {
    for (const scenario of ["cancel", "stdout", "stderr", "error", "exit", "invalid"]) {
      const fake = childFixture();
      const controller = new AbortController();
      const promise = executeReturnKeychain("agenttool:0123456789abcdef", "test-account", controller.signal, fake.spawn);
      if (scenario === "cancel") controller.abort(TOKEN);
      if (scenario === "stdout") fake.child.stdout.write("x".repeat(4099));
      if (scenario === "stderr") fake.child.stderr.write("x".repeat(4099));
      if (scenario === "error") fake.child.emit("error", new Error(TOKEN));
      if (scenario === "exit") fake.child.emit("close", 1);
      if (scenario === "invalid") { fake.child.stdout.write("two\nlines\n"); fake.child.emit("close", 0); }
      await errorCode(promise, scenario === "cancel" ? "cancelled" : "credential_unavailable");
      expect(fake.child.killed).toBe(true);
      expect(fake.child.stdout.destroyed).toBe(true);
      expect(fake.child.stderr.destroyed).toBe(true);
    }
  });
});

describe("real host and session composition with the producer's schema", () => {
  test("project verification and canonical observation produce only a closed locator report", async () => {
    const fake = httpsFixture([projectReply(), observationReply()]);
    let acquisitions = 0;
    const dependencies = createReturnHostDependencies(binding(), {
      environment: () => { acquisitions++; return TOKEN; }, request: fake.request,
    });
    dependencies.now = () => new Date("2026-09-04T12:00:00.000Z");
    const session = createReturnSession(binding(), dependencies);
    expect(session.status().status).toBe("ready");
    expect(acquisitions).toBe(0);
    expect(fake.calls).toEqual([]);
    const report = await session.observe();
    expect(report.status).toBe("observed");
    expect(report.failure).toBeNull();
    expect(report.observation).toEqual({
      identity_id: IDENTITY, status: "active", wake_version: 12,
      received_at: "2026-09-04T12:00:00.000Z",
      provenance: "authenticated_service_projection_not_identity_signature",
    });
    expect(report.boundaries.placement).toBe("tool_data_only");
    expect(report.boundaries.authority_granted).toBe("none");
    expect(report.binding.reader_identity_proven).toBe(false);
    expect(JSON.stringify(report)).not.toContain(TOKEN);
    expect(JSON.stringify(report)).not.toContain("DO_NOT_PROJECT_THIS_PROSE");
    expect(fake.calls.map((call) => call.path)).toEqual([CONTEXT, OBSERVE]);
    expect(acquisitions).toBe(1);
    expect(session.status().observation).toBeNull();
  });

  test("wrong project stops the native reader before observation; wrong subject never falls back", async () => {
    for (const wrongProject of [true, false]) {
      const fake = httpsFixture([projectReply(wrongProject ? IDENTITY : PROJECT), observationReply(PROJECT)]);
      const dependencies = createReturnHostDependencies(binding(), { environment: () => TOKEN, request: fake.request });
      const report = await createReturnSession(binding(), dependencies).observe();
      expect(report.failure).toBe(wrongProject ? "project_mismatch" : "subject_mismatch");
      expect(report.observation).toBeNull();
      expect(fake.calls.map((call) => call.path)).toEqual(wrongProject ? [CONTEXT] : [CONTEXT, OBSERVE]);
      expect(JSON.stringify(report)).not.toContain(TOKEN);
    }
  });

  test("credential reflection is rejected before the core's permissive context metadata projection", async () => {
    const context = projectReply();
    context.body = String(context.body).replace("DO_NOT_PROJECT_THIS_PROSE", TOKEN);
    const fake = httpsFixture([context, observationReply()]);
    const dependencies = createReturnHostDependencies(binding(), { environment: () => TOKEN, request: fake.request });
    const report = await createReturnSession(binding(), dependencies).observe();
    expect(report.failure).toBe("response_invalid");
    expect(report.observation).toBeNull();
    expect(fake.calls.map((call) => call.path)).toEqual([CONTEXT]);
    expect(JSON.stringify(report)).not.toContain(TOKEN);
  });

  test("caller cancellation closes the native read and yields a secret-free unavailable report", async () => {
    const fake = httpsFixture([{ hang: true }]);
    const dependencies = createReturnHostDependencies(binding(), { environment: () => TOKEN, request: fake.request });
    const controller = new AbortController();
    const pending = createReturnSession(binding(), dependencies).observe(controller.signal);
    queueMicrotask(() => controller.abort(TOKEN));
    const report = await pending;
    expect(report.status).toBe("unavailable");
    expect(report.failure).toBe("cancelled");
    expect(report.observation).toBeNull();
    expect(fake.outgoing.every((socket) => socket.destroyed)).toBe(true);
    expect(JSON.stringify(report)).not.toContain(TOKEN);
  });
});
