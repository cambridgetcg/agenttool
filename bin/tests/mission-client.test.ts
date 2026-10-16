/** Synthetic participant-only fixtures: no live service, project bearer, or host credentials. */
import { afterEach, describe, expect, test } from "bun:test";
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { Client } from "../../api/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js";
import { StdioClientTransport } from "../../api/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js";
import { Hono } from "../../api/node_modules/hono/dist/index.js";
import { createMissionGateway, type MissionGatewayDependencies } from "../../api/src/routes/collaboration";
import { collaborationTransportBoundary, isCollaborationPath } from "../../api/src/middleware/collaboration-boundary";
import { earlyDataReplayProtection } from "../../api/src/middleware/early-data";
import { apiCors } from "../../api/src/middleware/api-cors";
import { issueMissionGrantSchema, MissionError, missionOperation } from "../../api/src/services/collaboration/contracts";
import { canonicalMissionRequestBytes, missionSha256, verifyMissionProof } from "../../api/src/services/collaboration/proof";
import { correspondenceCanonicalJson } from "../../api/src/services/correspondence/canonical";
import * as client from "../agenttool-mission.mjs";

const M = "11111111-1111-4111-8111-111111111111";
const G = "22222222-2222-4222-8222-222222222222";
const I = "33333333-3333-4333-8333-333333333333";
const K = "44444444-4444-4444-8444-444444444444";
const E = "55555555-5555-4555-8555-555555555555";
const ORIGIN = "https://mission-fixture.invalid";
const TOKEN = `atcm_${Buffer.alloc(32, 23).toString("base64url")}`;
const CLI = resolve(import.meta.dir, "../agenttool-mission.mjs");
const NODE = Bun.which("node")!;
const cleanups: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const descriptor = { format: "agenttool-collaboration-mission/v1", purpose: "Exchange selected fixture observations", resources: [], acceptance_criteria: ["Return one reviewed reply"], principalities: [] };
const missionDigest = `sha256:${sha(correspondenceCanonicalJson(descriptor))}`;

function fixture(imported = true) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), "mission client's fixture-")));
  chmodSync(parent, 0o700);
  cleanups.push(() => rmSync(parent, { recursive: true, force: true }));
  const state = join(parent, "state");
  const enrollment = client.init(state, ORIGIN);
  const invitationFile = join(parent, "private-invitation.json");
  const profile = { format: "agenttool-mission-invitation/v1", origin: ORIGIN, mission_id: M, grant_id: G,
    identity_id: I, signing_key_id: K, public_key: enrollment.public_key,
    expires_at: new Date(Date.now() + 3_600_000).toISOString(), token: TOKEN };
  writeFileSync(invitationFile, JSON.stringify(profile), { mode: 0o600 });
  if (imported) client.importInvitation(state, invitationFile);
  return { parent, state, enrollment, invitationFile, profile };
}
function view(profile: ReturnType<typeof fixture>["profile"]) {
  return { mission: { mission_id: M, descriptor, mission_digest: missionDigest },
    grant: { mission_id: M, grant_id: G, identity_id: I, signing_key_id: K, origin: ORIGIN,
      actions: ["mission.read", "mission.observe"], expires_at: profile.expires_at } };
}
function receipt(raw: string) {
  return { event: { event_id: JSON.parse(raw).event_id, mission_id: M, grant_id: G,
    identity_id: I, signing_key_id: K, body_sha256: sha(raw), received_seq: "1", raw_body: raw } };
}
function eventPage(after = "0", seqs: string[] = [], more = false) {
  return { mission_id: M, events: seqs.map(received_seq => ({ event_id: E, received_seq })),
    page: { after, next_cursor: seqs.at(-1) ?? after, has_more: more } };
}
function run(args: string[], cwd: string, preload?: string) {
  return spawnSync(NODE, [...(preload ? ["--import", preload] : []), CLI, ...args], { cwd, env: { PATH: process.env.PATH ?? "", HOME: cwd, TMPDIR: tmpdir() },
    encoding: "utf8", timeout: 5000, maxBuffer: 256 * 1024 });
}
// Clearly synthetic administrator bearer: it never reaches a real service.
const BEARER = "at_synthetic_fixture_bearer_not_a_credential";
const SERVER_TOKEN = `atcm_${Buffer.alloc(32, 41).toString("base64url")}`;
const SERVICE_TOKEN = /^atcm_[A-Za-z0-9_-]{43}$/;
function admin(f: ReturnType<typeof fixture>, patch: Record<string, unknown> = {}) {
  const dir = join(f.parent, "admin"); mkdirSync(dir, { mode: 0o700 });
  const bearerFile = join(dir, "bearer"); writeFileSync(bearerFile, `${BEARER}\n`, { mode: 0o600 });
  const request = { format: "agenttool-mission-grant-request/v1", origin: ORIGIN, mission_id: M, grant_id: G, identity_id: I,
    signing_key_id: K, public_key: f.enrollment.public_key, actions: ["mission.observe", "mission.read"],
    expires_at: new Date(Date.now() + 3_600_000).toISOString(), ...patch };
  const requestFile = join(dir, "grant-request.json"); writeFileSync(requestFile, JSON.stringify(request), { mode: 0o600 });
  return { dir, bearerFile, request, requestFile, templateFile: join(dir, "invitation-template.json") };
}
function grantResponse(request: Record<string, any>, tokenSha256: string, patch: Record<string, unknown> = {}) {
  return { grant: { grant_id: request.grant_id, mission_id: request.mission_id, project_id: "66666666-6666-4666-8666-666666666666",
    identity_id: request.identity_id, signing_key_id: request.signing_key_id, issuing_api_key_id: "77777777-7777-4777-8777-777777777777",
    origin: request.origin, actions: [...request.actions].sort(), issued_at: new Date().toISOString(), expires_at: request.expires_at,
    accepted_at: null, revoked_at: null }, token_sha256: tokenSha256, token_source: "participant", ...patch };
}
function storedTokenText(state: string, tokenSha256: string) {
  return JSON.parse(readFileSync(join(state, "tokens", `${tokenSha256}.json`), "utf8")).token as string;
}
function proofInput(url: string, init: RequestInit, token: string) {
  const h = new Headers(init.headers);
  return { token, origin: ORIGIN, method: String(init.method), missionId: M, requestTarget: new URL(url).pathname,
    bodyBytes: Buffer.from(init.body === undefined ? "" : String(init.body)),
    proof: { grantId: h.get("X-Agenttool-Mission-Grant-Id")!, identityId: h.get("X-Agenttool-Mission-Identity-Id")!,
      keyId: h.get("X-Agenttool-Mission-Key-Id")!, timestamp: h.get("X-Agenttool-Mission-Timestamp")!, signature: h.get("X-Agenttool-Mission-Signature")! } };
}

describe.skipIf(process.platform === "win32")("portable mission participant", () => {
  test("init creates private independent keys, exposes public enrollment only, and refuses overwrite", () => {
    const f = fixture(false);
    expect(statSync(f.state).mode & 0o777).toBe(0o700);
    expect(statSync(join(f.state, "outbox")).mode & 0o777).toBe(0o700);
    for (const name of ["signing-key.pem", "enrollment.json"]) expect(statSync(join(f.state, name)).mode & 0o777).toBe(0o600);
    const privateBytes = readFileSync(join(f.state, "signing-key.pem"));
    const key = createPrivateKey(privateBytes);
    expect(key.asymmetricKeyType).toBe("ed25519");
    const pub = createPublicKey(key).export({ format: "jwk" });
    expect(f.enrollment.public_key).toBe(Buffer.from(pub.x!, "base64url").toString("base64"));
    expect(Object.keys(client.enrollment(f.state)).sort()).toEqual(["format", "origin", "public_key"]);
    expect(JSON.stringify(f.enrollment)).not.toContain("PRIVATE KEY");
    expect(() => client.init(f.state, ORIGIN)).toThrow("never overwritten");
    expect(readFileSync(join(f.state, "signing-key.pem"))).toEqual(privateBytes);
    expect(fixture(false).enrollment.public_key).not.toBe(f.enrollment.public_key);
    const printed = run(["enrollment", "--state", f.state], f.parent);
    expect(printed.status).toBe(0);
    expect(printed.stderr).toBe("");
    expect(JSON.parse(printed.stdout)).toEqual(f.enrollment);
    expect(printed.stdout).not.toContain(TOKEN);
  });

  test("state inside Git and symlinked or accessible credential files fail closed", () => {
    const f = fixture(false);
    const checkout = join(f.parent, "checkout"); mkdirSync(checkout); mkdirSync(join(checkout, ".git"));
    const forbidden = join(checkout, "state");
    expect(() => client.init(forbidden, ORIGIN)).toThrow("outside a Git");
    expect(existsSync(forbidden)).toBe(false);
    chmodSync(f.invitationFile, 0o644);
    expect(() => client.importInvitation(f.state, f.invitationFile)).toThrow("owner-only");
    expect(existsSync(join(f.state, "invitation.json"))).toBe(false);
    chmodSync(f.invitationFile, 0o600);
    const link = join(f.parent, "linked-invitation"); symlinkSync(f.invitationFile, link);
    expect(() => client.importInvitation(f.state, link)).toThrow();
    const stateLink = join(f.parent, "linked-state"); symlinkSync(f.state, stateLink);
    expect(() => client.enrollment(stateLink)).toThrow();
  });

  test("FIFO invitation and summary inputs fail without waiting for a writer or creating an event", () => {
    const f = fixture(false);
    const fifo = join(f.parent, "not-a-regular-file");
    const made = spawnSync("mkfifo", [fifo], { env: { PATH: "/usr/bin:/bin" }, encoding: "utf8", timeout: 2000 });
    expect(made.status).toBe(0);
    chmodSync(fifo, 0o600);
    for (const args of [
      ["import", "--state", f.state, "--invitation-file", fifo],
      ["send", "--state", f.state, "--summary-file", fifo],
    ]) {
      const result = run(args, f.parent);
      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
    }
    expect(existsSync(join(f.state, "invitation.json"))).toBe(false);
    expect(readdirSync(join(f.state, "outbox"))).toEqual([]);
  });

  test("import binds origin and public key, rejects broad/expired credentials and never overwrites", () => {
    const f = fixture(false);
    for (const patch of [
      { origin: "https://another.invalid" }, { public_key: Buffer.alloc(32).toString("base64") },
      { token: "at_fixture_broad_project_bearer" }, { expires_at: "2020-01-01T00:00:00.000Z" },
      { project_bearer: "must-not-be-imported" },
    ]) {
      writeFileSync(f.invitationFile, JSON.stringify({ ...f.profile, ...patch }));
      expect(() => client.importInvitation(f.state, f.invitationFile)).toThrow();
      expect(existsSync(join(f.state, "invitation.json"))).toBe(false);
    }
    writeFileSync(f.invitationFile, JSON.stringify(f.profile));
    expect(client.importInvitation(f.state, f.invitationFile)).toEqual({ mission_id: M, grant_id: G, expires_at: f.profile.expires_at, imported: true });
    expect(statSync(join(f.state, "invitation.json")).mode & 0o777).toBe(0o600);
    expect(() => client.importInvitation(f.state, f.invitationFile)).toThrow();
    const replacement = generateKeyPairSync("ed25519").privateKey.export({ format: "pem", type: "pkcs8" });
    writeFileSync(join(f.state, "signing-key.pem"), replacement);
    expect(() => client.enrollment(f.state)).toThrow("does not match");
    for (const bad of ["http://mission-fixture.invalid", ORIGIN + "/", ORIGIN + "/path", "https://user@mission-fixture.invalid"]) expect(() => client.origin(bad)).toThrow();
  });

  test("Node signatures match the actual server digest and verify against all request bindings", async () => {
    const f = fixture();
    const raw = JSON.stringify({ event_id: E, summary: "雨夜 🌞\nexact selected bytes" });
    let calls = 0;
    await client.request(f.state, "POST", "/events", raw, { fetchImpl: async (url: string, options: RequestInit) => {
      calls++;
      const h = new Headers(options.headers);
      const input = { token: TOKEN, origin: ORIGIN, method: "POST", missionId: M,
        requestTarget: new URL(url).pathname, bodyBytes: Buffer.from(String(options.body)),
        proof: { grantId: h.get("X-Agenttool-Mission-Grant-Id")!, identityId: h.get("X-Agenttool-Mission-Identity-Id")!,
          keyId: h.get("X-Agenttool-Mission-Key-Id")!, timestamp: h.get("X-Agenttool-Mission-Timestamp")!, signature: h.get("X-Agenttool-Mission-Signature")! } };
      expect(url).toBe(`${ORIGIN}/v1/collaboration/missions/${M}/events`);
      expect(options.body).toBe(raw);
      expect(h.get("Authorization")).toBe(`Bearer ${TOKEN}`);
      expect(h.get("Content-Type")).toBe("application/json");
      expect(options.redirect).toBe("error");
      expect(options.signal).toBeInstanceOf(AbortSignal);
      expect(Buffer.from(client.requestDigest(f.profile, "POST", input.requestTarget, raw, input.proof.timestamp)))
        .toEqual(Buffer.from(canonicalMissionRequestBytes(input)));
      expect(verifyMissionProof(input, f.enrollment.public_key, new Date())).toBe(true);
      expect(verifyMissionProof({ ...input, bodyBytes: Buffer.from(raw + " ") }, f.enrollment.public_key, new Date())).toBe(false);
      expect(verifyMissionProof({ ...input, origin: "https://other.invalid" }, f.enrollment.public_key, new Date())).toBe(false);
      return response(receipt(raw));
    } });
    expect(calls).toBe(1);
  });

  test("participant operations refuse admin paths and changed local bindings before fetch", async () => {
    const f = fixture(); let calls = 0;
    const options = { fetchImpl: async () => { calls++; return response({}); } };
    for (const suffix of ["/grants", "/revoke", "/events?after=0&limit=20&project_id=x", "/events/"]) {
      await expect(client.request(f.state, "GET", suffix, "", options)).rejects.toThrow();
    }
    await expect(client.request(f.state, "GET", "/context", "{}", options)).rejects.toThrow();
    writeFileSync(join(f.state, "invitation.json"), JSON.stringify({ ...f.profile, origin: "https://other.invalid" }));
    await expect(client.request(f.state, "GET", "/context", "", options)).rejects.toThrow();
    expect(calls).toBe(0);
  });

  test("invitation inspection never accepts; acceptance requires the exact reviewed descriptor", async () => {
    const f = fixture(); const calls: Array<{ method: unknown; body: unknown; url: string }> = [];
    const options = { fetchImpl: async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method, body: init.body }); return response(view(f.profile));
    } };
    expect((await client.invitation(f.state, options)).mission.mission_digest).toBe(missionDigest);
    expect(calls.map(call => call.method)).toEqual(["GET"]);
    await expect(client.accept(f.state, undefined, options)).rejects.toThrow();
    expect(calls.length).toBe(1);
    await expect(client.accept(f.state, `sha256:${"0".repeat(64)}`, options)).rejects.toThrow("does not match");
    expect(calls.map(call => call.method)).toEqual(["GET", "GET"]);
    await client.accept(f.state, missionDigest, options);
    expect(calls.map(call => call.method)).toEqual(["GET", "GET", "GET", "POST"]);
    expect(calls.at(-1)?.body).toBe(JSON.stringify({ mission_digest: missionDigest }));
    expect(calls.at(-1)?.url.endsWith("/accept")).toBe(true);
    const changed = view(f.profile); changed.mission.descriptor = { ...descriptor, purpose: "Silently altered purpose" };
    await expect(client.accept(f.state, missionDigest, { fetchImpl: async () => response(changed) })).rejects.toThrow("binding");
  });

  test("HTTP response bytes, refusal messages and transport time are bounded without retry", async () => {
    const f = fixture(); let attempts = 0;
    await expect(client.request(f.state, "GET", "/context", "", { fetchImpl: async (_url: string, init: RequestInit) => {
      attempts++; expect(init.redirect).toBe("error"); throw new Error(`private transport detail ${TOKEN}`);
    } })).rejects.toThrow("No automatic retry");
    expect(attempts).toBe(1);
    await expect(client.request(f.state, "GET", "/context", "", { fetchImpl: async () => response({ error: TOKEN, details: TOKEN }, 403) }))
      .rejects.toThrow("Mission request refused: HTTP 403.");
    await expect(client.boundedJson(response({ error: "collaboration_mission_invalid_credential", details: TOKEN }, 401)))
      .rejects.toThrow("HTTP 401 collaboration_mission_invalid_credential");
    let cancelled = false;
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(1_048_577)); }, cancel() { cancelled = true; } });
    await expect(client.boundedJson(new Response(stream))).rejects.toThrow("exceeds 1 MiB");
    expect(cancelled).toBe(true);
    await expect(client.boundedJson(new Response(`invalid ${TOKEN}`))).rejects.toThrow("invalid JSON");
    await expect(client.boundedJson(new Response(null))).rejects.toThrow("Empty service response");
    let aborted = false;
    await expect(client.request(f.state, "GET", "/context", "", { timeout: 15, fetchImpl: async (_url: string, init: RequestInit) => {
      attempts++;
      return await new Promise((_resolve, reject) => {
        init.signal!.addEventListener("abort", () => { aborted = true; reject(init.signal!.reason); }, { once: true });
      });
    } })).rejects.toThrow("No automatic retry");
    expect(aborted).toBe(true);
    expect(attempts).toBe(2);
  });

  test("uncertain send preserves exact body before HTTP; explicit retry reuses it and records one receipt", async () => {
    const f = fixture(); let attempts = 0; let raw = ""; let eventId = "";
    let failure = "";
    try {
      await client.send(f.state, "Selected observation: 雨夜 🌞", { fetchImpl: async (_url: string, init: RequestInit) => {
        attempts++; raw = String(init.body); eventId = JSON.parse(raw).event_id;
        expect(readFileSync(join(f.state, "outbox", `${eventId}.json`), "utf8")).toBe(raw);
        expect(statSync(join(f.state, "outbox", `${eventId}.json`)).mode & 0o777).toBe(0o600);
        throw new Error(`uncertain response containing ${TOKEN}`);
      } });
    } catch (error) { failure = String(error); }
    expect(attempts).toBe(1);
    expect(failure).toContain(eventId);
    expect(failure).toContain("remains saved");
    expect(failure).not.toContain(TOKEN);
    expect(readdirSync(join(f.state, "outbox"))).toEqual([`${eventId}.json`]);
    const retryOptions = { fetchImpl: async (_url: string, init: RequestInit) => {
      attempts++; expect(init.body).toBe(raw); return response(receipt(raw));
    } };
    await client.retry(f.state, eventId, retryOptions);
    const receiptFile = join(f.state, "outbox", `${eventId}.receipt.json`);
    const savedReceipt = readFileSync(receiptFile);
    expect(statSync(receiptFile).mode & 0o777).toBe(0o600);
    await client.retry(f.state, eventId, retryOptions);
    expect(attempts).toBe(3);
    expect(readFileSync(receiptFile)).toEqual(savedReceipt);
    expect(readdirSync(join(f.state, "outbox")).sort()).toEqual([`${eventId}.json`, `${eventId}.receipt.json`].sort());
  });

  test("retry signs original whitespace; mismatched receipts or damaged saved IDs never become success", async () => {
    const f = fixture();
    const raw = `{ "summary": "Selected exact bytes 🌞", "event_id": "${E}" }\n`;
    const saved = join(f.state, "outbox", `${E}.json`); writeFileSync(saved, raw, { mode: 0o600 });
    let calls = 0;
    await expect(client.retry(f.state, E, { fetchImpl: async (_url: string, init: RequestInit) => {
      calls++; expect(init.body).toBe(raw); return response({ event: { ...receipt(raw).event, body_sha256: sha(raw.trim()) } });
    } })).rejects.toThrow("Receipt does not match");
    expect(existsSync(join(f.state, "outbox", `${E}.receipt.json`))).toBe(false);
    writeFileSync(saved, JSON.stringify({ event_id: M, summary: "wrong saved id" }));
    await expect(client.retry(f.state, E, { fetchImpl: async () => { calls++; return response({}); } })).rejects.toThrow("UUID does not match");
    expect(calls).toBe(1);
  });

  test("selected text is bounded by Unicode scalars before any outbox or network effect", async () => {
    const f = fixture(); let calls = 0;
    const options = { fetchImpl: async (_url: string, init: RequestInit) => { calls++; return response(receipt(String(init.body))); } };
    for (const invalid of ["", "x\0y", "\ud800", "🌞".repeat(1001)]) await expect(client.send(f.state, invalid, options)).rejects.toThrow();
    expect(calls).toBe(0); expect(readdirSync(join(f.state, "outbox"))).toEqual([]);
    await client.send(f.state, "🌞".repeat(1000), options);
    expect(calls).toBe(1);
  });

  test("event paging preserves bigint cursors and requires complete ordered pages", async () => {
    const f = fixture(); const after = "9007199254740993";
    const seq = "9007199254740994";
    const result = await client.events(f.state, after, { fetchImpl: async (url: string, init: RequestInit) => {
      expect(url.endsWith(`/events?after=${after}&limit=20`)).toBe(true);
      expect(init.body).toBeUndefined(); return response(eventPage(after, [seq], true));
    } });
    expect(result.page.next_cursor).toBe(seq); expect(result.page.has_more).toBe(true);
    for (const bad of [
      { ...eventPage(after), mission_id: G }, eventPage(after, [after]), eventPage(after, [seq, after]),
      { ...eventPage(after, [seq]), page: { after, next_cursor: "9007199254740995", has_more: false } },
      { ...eventPage(after), page: { after, next_cursor: Number(after), has_more: false } },
      eventPage(after, Array(21).fill(seq)),
    ]) await expect(client.events(f.state, after, { fetchImpl: async () => response(bad) })).rejects.toThrow();
    let calls = 0;
    for (const invalid of ["01", "-1", "9223372036854775808", 0]) {
      await expect(client.events(f.state, invalid, { fetchImpl: async () => { calls++; return response({}); } })).rejects.toThrow();
    }
    expect(calls).toBe(0);
    expect((await client.events(f.state, "9223372036854775807", { fetchImpl: async () => response(eventPage("9223372036854775807")) })).page.next_cursor)
      .toBe("9223372036854775807");
  });

  test("bounded waiting stops on data or a request error and refuses an unbounded duration", async () => {
    const f = fixture(); let calls = 0;
    expect((await client.wait(f.state, "0", 1, { fetchImpl: async () => { calls++; return response(eventPage("0", ["1"])); } })).events.length).toBe(1);
    expect(calls).toBe(1);
    await expect(client.wait(f.state, "0", 1, { fetchImpl: async () => { calls++; throw new Error("offline fixture"); } })).rejects.toThrow("No automatic retry");
    expect(calls).toBe(2);
    for (const seconds of [0, 46, 1.5]) await expect(client.wait(f.state, "0", seconds, {})).rejects.toThrow();
  });

  test("actual SDK connects to Node STDIO, lists tools, preserves explicit acceptance, and receives safe errors", async () => {
    const f = fixture();
    // Inject one synthetic service before loading the executable. This process cannot
    // contact the public API: every fetch is handled here, and no real credential exists.
    const bootstrap = `
      import { mcp } from ${JSON.stringify(pathToFileURL(CLI).href)};
      import { createHash } from 'node:crypto';
      let accepted = false;
      const view = ${JSON.stringify(view(f.profile))};
      globalThis.fetch = async (url, options) => {
        if (url.endsWith('/invitation')) return Response.json(view);
        if (url.endsWith('/accept')) { accepted = true; return Response.json(view); }
        if (url.endsWith('/events') && options.method === 'POST') {
          if (!accepted) return Response.json({error:'collaboration_mission_acceptance_required'}, {status:403});
          const body = JSON.parse(options.body);
          return Response.json({event:{event_id:body.event_id,body_sha256:createHash('sha256').update(options.body).digest('hex')}});
        }
        throw new Error('Unexpected synthetic request');
      };
      mcp(${JSON.stringify(f.state)});
    `;
    const transport = new StdioClientTransport({ command: NODE, args: ["--input-type=module", "--eval", bootstrap],
      cwd: f.parent, env: { HOME: f.parent, PATH: process.env.PATH ?? "", TMPDIR: tmpdir() }, stderr: "pipe" });
    const sdk = new Client({ name: "mission-fixture-client", version: "0.0.0" }, { capabilities: {} });
    cleanups.push(async () => { await sdk.close(); });
    let stderr = ""; transport.stderr?.on("data", chunk => { stderr += chunk.toString(); });
    await sdk.connect(transport);
    expect(sdk.getServerVersion()?.name).toBe("agenttool-mission-trial");
    const tools = await sdk.listTools();
    expect(tools.tools.map(tool => tool.name).sort()).toEqual(["mission_invitation", "mission_accept", "mission_send", "mission_events", "mission_wait", "mission_retry"].sort());
    expect(tools.tools.every(tool => tool.inputSchema.additionalProperties === false)).toBe(true);
    const read = await sdk.callTool({ name: "mission_invitation", arguments: {} });
    expect(read.isError).not.toBe(true);
    expect(JSON.parse((read.content as any)[0].text).mission.mission_digest).toBe(missionDigest);
    const premature = await sdk.callTool({ name: "mission_send", arguments: { summary: "Requires explicit acceptance" } });
    expect(premature.isError).toBe(true);
    expect(JSON.stringify(premature)).toContain("acceptance_required");
    const accepted = await sdk.callTool({ name: "mission_accept", arguments: { digest: missionDigest } });
    expect(accepted.isError).not.toBe(true);
    const sent = await sdk.callTool({ name: "mission_send", arguments: { summary: "Reviewed fixture observation" } });
    expect(sent.isError).not.toBe(true);
    const invalid = await sdk.callTool({ name: "mission_accept", arguments: { digest: missionDigest, project_token: "unused" } });
    expect(invalid.isError).toBe(true);
    const unknown = await sdk.callTool({ name: "arbitrary_execute", arguments: {} });
    expect(unknown.isError).toBe(true);
    expect(JSON.stringify([tools, read, premature, accepted, sent, invalid, unknown])).not.toContain(TOKEN);
    expect(stderr).toBe("");
  }, 10_000);

  test("CLI errors redact malformed credential bytes and reject flags without mutating state", () => {
    const f = fixture();
    const before = readFileSync(join(f.state, "enrollment.json"));
    const duplicate = run(["enrollment", "--state", f.state, "--state", f.state], f.parent);
    expect(duplicate.status).toBe(1); expect(duplicate.stdout).toBe("");
    expect(readFileSync(join(f.state, "enrollment.json"))).toEqual(before);
    writeFileSync(join(f.state, "invitation.json"), `{ broken ${TOKEN}`);
    const malformed = run(["invitation", "--state", f.state], f.parent);
    expect(malformed.status).toBe(1); expect(malformed.stdout).toBe("");
    expect(malformed.stderr).not.toContain(TOKEN);
    expect(malformed.stderr).toContain("Local operation failed");
  });
});

describe.skipIf(process.platform === "win32")("participant-chosen grant tokens, replacement and self-leave", () => {
  test("token-new stores one service-shaped token privately and prints only its hash", () => {
    const f = fixture(false);
    const first = client.newToken(f.state), second = client.newToken(f.state);
    expect(Object.keys(first).sort()).toEqual(["token_id", "token_sha256"]);
    expect(first.token_sha256).toMatch(/^[0-9a-f]{64}$/); expect(first.token_id).toBe(first.token_sha256.slice(0, 12));
    expect(second.token_sha256).not.toBe(first.token_sha256);
    expect(statSync(join(f.state, "tokens")).mode & 0o777).toBe(0o700);
    const file = join(f.state, "tokens", `${first.token_sha256}.json`);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const stored = JSON.parse(readFileSync(file, "utf8"));
    expect(Object.keys(stored).sort()).toEqual(["created_at", "format", "token", "token_sha256"]);
    // Same shape and hash the service checks: atcm_ + canonical base64url of 32 bytes, plain SHA-256 hex.
    expect(stored.token).toMatch(SERVICE_TOKEN);
    expect(Buffer.from(stored.token.slice(5), "base64url")).toHaveLength(32);
    expect(Buffer.from(stored.token.slice(5), "base64url").toString("base64url")).toBe(stored.token.slice(5));
    expect(missionSha256(stored.token)).toBe(first.token_sha256);
    const printed = run(["token-new", "--state", f.state], f.parent);
    expect(printed.status).toBe(0); expect(printed.stderr).toBe("");
    const value = JSON.parse(printed.stdout);
    expect(Object.keys(value).sort()).toEqual(["token_id", "token_sha256"]);
    expect(printed.stdout).not.toContain(storedTokenText(f.state, value.token_sha256));
    expect(printed.stdout).not.toContain("atcm_");
    const stray = join(f.parent, "not-a-state"); mkdirSync(stray, { mode: 0o700 });
    expect(() => client.newToken(stray)).toThrow();
    expect(existsSync(join(stray, "tokens"))).toBe(false);
  });

  test("admin grant sends only the token hash, accepts a token-free response and writes a private template", async () => {
    const f = fixture(false), a = admin(f), { token_sha256: tokenSha256 } = client.newToken(f.state);
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const result = await client.issueGrant({ bearerFile: a.bearerFile, requestFile: a.requestFile, tokenSha256, templateFile: a.templateFile, serviceOrigin: ORIGIN },
      { fetchImpl: async (url: string, init: RequestInit) => { calls.push({ url, init }); return response(grantResponse(a.request, tokenSha256), 201); } });
    expect(calls).toHaveLength(1);
    const [{ url, init }] = calls, headers = new Headers(init.headers);
    expect(url).toBe(`${ORIGIN}/v1/collaboration/missions/${M}/grants`);
    expect(init.method).toBe("POST"); expect(init.redirect).toBe("error"); expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(headers.get("Authorization")).toBe(`Bearer ${BEARER}`); expect(headers.get("Content-Type")).toBe("application/json");
    expect(JSON.parse(String(init.body))).toEqual({ grant_id: G, identity_id: I, signing_key_id: K,
      actions: a.request.actions, expires_at: a.request.expires_at, token_sha256: tokenSha256 });
    expect(String(init.body)).not.toContain(storedTokenText(f.state, tokenSha256));
    expect(result).toEqual({ mission_id: M, grant_id: G, expires_at: a.request.expires_at, token_sha256: tokenSha256,
      token_source: "participant", template_written: true });
    expect(JSON.stringify(result)).not.toContain(BEARER);
    expect(statSync(a.templateFile).mode & 0o777).toBe(0o600);
    const template = JSON.parse(readFileSync(a.templateFile, "utf8"));
    expect(template).toEqual({ format: "agenttool-mission-invitation-template/v1", origin: ORIGIN, mission_id: M, grant_id: G,
      identity_id: I, signing_key_id: K, public_key: f.enrollment.public_key, expires_at: a.request.expires_at, token_sha256: tokenSha256 });
    expect(readFileSync(a.templateFile, "utf8")).not.toContain("atcm_");
    expect(readFileSync(a.templateFile, "utf8")).not.toContain(BEARER);

    // The participant assembles the normal invitation; the unchanged import/accept flow then signs with its own token.
    const invitationFile = join(f.parent, "assembled-invitation.json");
    expect(client.assembleInvitation(f.state, a.templateFile, invitationFile)).toEqual({ mission_id: M, grant_id: G,
      expires_at: a.request.expires_at, token_sha256: tokenSha256, assembled: true });
    expect(statSync(invitationFile).mode & 0o777).toBe(0o600);
    const assembled = JSON.parse(readFileSync(invitationFile, "utf8")), token = storedTokenText(f.state, tokenSha256);
    expect(assembled).toEqual({ format: "agenttool-mission-invitation/v1", origin: ORIGIN, mission_id: M, grant_id: G,
      identity_id: I, signing_key_id: K, public_key: f.enrollment.public_key, expires_at: a.request.expires_at, token });
    expect(client.importInvitation(f.state, invitationFile)).toEqual({ mission_id: M, grant_id: G, expires_at: a.request.expires_at, imported: true });
    const seen: string[] = [];
    await client.accept(f.state, missionDigest, { fetchImpl: async (requestUrl: string, requestInit: RequestInit) => {
      const input = proofInput(requestUrl, requestInit, token);
      expect(new Headers(requestInit.headers).get("Authorization")).toBe(`Bearer ${token}`);
      expect(missionSha256(token)).toBe(tokenSha256);
      expect(verifyMissionProof(input, f.enrollment.public_key, new Date())).toBe(true);
      seen.push(`${requestInit.method} ${new URL(requestUrl).pathname.split("/").at(-1)}`);
      return response(view(a.request as any));
    } });
    expect(seen).toEqual(["GET invitation", "POST accept"]);
  });

  test("admin grant refuses unsafe local inputs before any request", async () => {
    const f = fixture(false), { token_sha256: tokenSha256 } = client.newToken(f.state);
    let calls = 0;
    const options = { fetchImpl: async () => { calls++; return response({}); } };
    const rewrite = (a: ReturnType<typeof admin>, patch: Record<string, unknown>) => {
      writeFileSync(a.requestFile, JSON.stringify({ ...a.request, ...patch }), { mode: 0o600 }); return {};
    };
    const cases: Array<(a: ReturnType<typeof admin>) => Record<string, string | undefined>> = [
      () => ({ tokenSha256: tokenSha256.toUpperCase() }), () => ({ tokenSha256: tokenSha256.slice(1) }), () => ({ tokenSha256: undefined }),
      () => ({ bearerFile: "relative-bearer" }), () => ({ requestFile: "relative-request.json" }),
      a => { writeFileSync(a.templateFile, "{}", { mode: 0o600 }); return {}; },
      a => { chmodSync(a.bearerFile, 0o644); return {}; },
      a => { writeFileSync(a.bearerFile, TOKEN, { mode: 0o600 }); return {}; },
      a => { writeFileSync(a.bearerFile, `Bearer ${BEARER}`, { mode: 0o600 }); return {}; },
      a => { const checkout = join(a.dir, "checkout"); mkdirSync(join(checkout, ".git"), { recursive: true }); return { templateFile: join(checkout, "template.json") }; },
      a => rewrite(a, { token: TOKEN }), a => rewrite(a, { expires_at: "2020-01-01T00:00:00.000Z" }),
      a => rewrite(a, { expires_at: new Date(Date.now() + 90_000_000).toISOString() }),
      a => rewrite(a, { actions: ["mission.admin"] }), a => rewrite(a, { actions: ["mission.read", "mission.read"] }),
      a => rewrite(a, { origin: "http://mission-fixture.invalid" }), a => rewrite(a, { public_key: "not-a-key" }),
      a => rewrite(a, { grant_id: "not-a-uuid" }),
      // The bearer's destination comes from the administrator, never from the request file alone.
      () => ({ serviceOrigin: undefined }), () => ({ serviceOrigin: "https://other.invalid" }),
      () => ({ serviceOrigin: "http://mission-fixture.invalid" }), () => ({ serviceOrigin: `${ORIGIN}/` }),
      a => rewrite(a, { origin: "https://attacker.invalid" }),
    ];
    for (const mutate of cases) {
      rmSync(join(f.parent, "admin"), { recursive: true, force: true });
      const a = admin(f), patch = mutate(a);
      const input = { bearerFile: a.bearerFile, requestFile: a.requestFile, tokenSha256, templateFile: a.templateFile, serviceOrigin: ORIGIN, ...patch } as any;
      const existingTemplate = existsSync(a.templateFile) ? readFileSync(a.templateFile, "utf8") : null;
      let failure = "";
      try { await client.issueGrant(input, options); } catch (error) { failure = String(error); }
      expect(failure).not.toBe(""); expect(failure).not.toContain(BEARER); expect(failure).not.toContain(TOKEN);
      expect(calls).toBe(0);
      expect(existsSync(a.templateFile) ? readFileSync(a.templateFile, "utf8") : null).toBe(existingTemplate);
      expect(existsSync(join(a.dir, "checkout", "template.json"))).toBe(false);
    }
  });

  test("admin grant never saves a service token and reports conflicts and uncertainty without retry", async () => {
    const f = fixture(false), { token_sha256: tokenSha256 } = client.newToken(f.state);
    const variants: Array<[string, (request: any) => Response, string]> = [
      ["service-token", request => response({ ...grantResponse(request, tokenSha256), token: SERVER_TOKEN }, 201), "revoke grant"],
      ["nested-token", request => { const r: any = grantResponse(request, tokenSha256); r.grant.token = SERVER_TOKEN; return response(r, 201); }, "revoke grant"],
      ["server-source", request => response(grantResponse(request, tokenSha256, { token_source: "server" }), 201), "does not confirm"],
      ["other-hash", request => response(grantResponse(request, "0".repeat(64)), 201), "does not confirm"],
      ["missing-echo", request => { const r: any = grantResponse(request, tokenSha256); delete r.token_sha256; return response(r, 201); }, "does not confirm"],
      ["other-grant", request => response(grantResponse({ ...request, grant_id: E }, tokenSha256), 201), "does not confirm"],
      ["other-origin", request => response(grantResponse({ ...request, origin: "https://other.invalid" }, tokenSha256), 201), "does not confirm"],
      ["later-expiry", request => response(grantResponse({ ...request, expires_at: new Date(Date.parse(request.expires_at) + 1000).toISOString() }, tokenSha256), 201), "does not confirm"],
      ["conflict", () => response({ error: "token_hash_conflict", detail: BEARER }, 409), "HTTP 409 token_hash_conflict"],
      ["older-server", () => response({ error: "invalid_mission_grant_request" }, 400), "HTTP 400 invalid_mission_grant_request"],
      ["transport", () => { throw new Error(`socket closed ${BEARER}`); }, "issuance is uncertain"],
    ];
    for (const [name, reply, expected] of variants) {
      rmSync(join(f.parent, "admin"), { recursive: true, force: true });
      const a = admin(f); let calls = 0, failure = "";
      try {
        await client.issueGrant({ bearerFile: a.bearerFile, requestFile: a.requestFile, tokenSha256, templateFile: a.templateFile, serviceOrigin: ORIGIN },
          { fetchImpl: async () => { calls++; return reply(a.request); } });
      } catch (error) { failure = String(error); }
      expect(calls, name).toBe(1);
      expect(failure, name).toContain(expected);
      expect(failure, name).not.toContain(BEARER); expect(failure, name).not.toContain(SERVER_TOKEN);
      expect(existsSync(a.templateFile), name).toBe(false);
    }
  });

  test("admin grant sends the bearer only to the administrator's pinned origin, checked before the bearer is read", async () => {
    const f = fixture(false), { token_sha256: tokenSha256 } = client.newToken(f.state);
    const attempt = async (a: ReturnType<typeof admin>, serviceOrigin?: string) => {
      const urls: string[] = []; let failure = "";
      try {
        await client.issueGrant({ bearerFile: a.bearerFile, requestFile: a.requestFile, tokenSha256, templateFile: a.templateFile,
          ...(serviceOrigin === undefined ? {} : { serviceOrigin }) }, { fetchImpl: async (url: string) => {
          urls.push(url); return response(grantResponse(a.request, tokenSha256), 201);
        } });
      } catch (error) { failure = String(error); }
      return { urls, failure };
    };
    // A participant-relayed origin in the request file, without the administrator's matching --origin, sends nothing.
    // The bearer file is deliberately unusable (0644): the origin refusal comes first, so it is never read.
    let a = admin(f); chmodSync(a.bearerFile, 0o644);
    let outcome = await attempt(a);
    expect(outcome.urls).toEqual([]); expect(outcome.failure).toContain(`other than ${client.DEFAULT_ORIGIN}`);
    expect(outcome.failure).not.toContain(BEARER); expect(existsSync(a.templateFile)).toBe(false);
    rmSync(a.dir, { recursive: true, force: true });
    a = admin(f, { origin: "https://attacker.invalid" }); chmodSync(a.bearerFile, 0o644);
    outcome = await attempt(a, ORIGIN);
    expect(outcome.urls).toEqual([]); expect(outcome.failure).toContain("differs from --origin"); expect(existsSync(a.templateFile)).toBe(false);
    rmSync(a.dir, { recursive: true, force: true });
    // Without --origin, the default service is the only destination.
    a = admin(f, { origin: client.DEFAULT_ORIGIN });
    outcome = await attempt(a);
    expect(outcome.failure).toBe(""); expect(outcome.urls).toEqual([`${client.DEFAULT_ORIGIN}/v1/collaboration/missions/${M}/grants`]);
    expect(JSON.parse(readFileSync(a.templateFile, "utf8")).origin).toBe(client.DEFAULT_ORIGIN);
  });

  test("invitation-assemble needs the matching local token and binds origin, key, expiry and a new private output", () => {
    const f = fixture(false), a = admin(f);
    const write = (value: unknown, mode = 0o600) => { rmSync(a.templateFile, { force: true }); writeFileSync(a.templateFile, JSON.stringify(value), { mode }); };
    const base = (tokenSha256: string) => ({ format: "agenttool-mission-invitation-template/v1", origin: ORIGIN, mission_id: M, grant_id: G,
      identity_id: I, signing_key_id: K, public_key: f.enrollment.public_key, expires_at: a.request.expires_at, token_sha256: tokenSha256 });
    const out = join(f.parent, "assembled.json");
    write(base("a".repeat(64)));
    expect(() => client.assembleInvitation(f.state, a.templateFile, out)).toThrow("No token generated on this device");
    const { token_sha256: tokenSha256 } = client.newToken(f.state);
    expect(() => client.assembleInvitation(f.state, a.templateFile, out)).toThrow("No token generated on this device");
    for (const [patch, mode] of [
      [{ origin: "https://other.invalid" }, 0o600], [{ public_key: Buffer.alloc(32).toString("base64") }, 0o600],
      [{ expires_at: "2020-01-01T00:00:00.000Z" }, 0o600], [{ token: TOKEN }, 0o600], [{ format: "agenttool-mission-invitation/v1" }, 0o600],
      [{ grant_id: "not-a-uuid" }, 0o600], [{ token_sha256: tokenSha256.toUpperCase() }, 0o600], [{}, 0o644],
    ] as Array<[Record<string, unknown>, number]>) {
      write({ ...base(tokenSha256), ...patch }, mode);
      expect(() => client.assembleInvitation(f.state, a.templateFile, out)).toThrow();
      expect(existsSync(out)).toBe(false);
    }
    write(base(tokenSha256));
    expect(() => client.assembleInvitation(f.state, a.templateFile, "relative.json")).toThrow();
    const checkout = join(f.parent, "checkout"); mkdirSync(join(checkout, ".git"), { recursive: true });
    expect(() => client.assembleInvitation(f.state, a.templateFile, join(checkout, "invitation.json"))).toThrow("outside a Git");
    expect(existsSync(join(checkout, "invitation.json"))).toBe(false);
    writeFileSync(out, "existing", { mode: 0o600 });
    expect(() => client.assembleInvitation(f.state, a.templateFile, out)).toThrow("never overwritten");
    expect(readFileSync(out, "utf8")).toBe("existing"); rmSync(out);
    const tokenFile = join(f.state, "tokens", `${tokenSha256}.json`), saved = readFileSync(tokenFile, "utf8");
    writeFileSync(tokenFile, JSON.stringify({ ...JSON.parse(saved), token: SERVER_TOKEN }));
    expect(() => client.assembleInvitation(f.state, a.templateFile, out)).toThrow("does not match its recorded hash");
    expect(existsSync(out)).toBe(false);
    writeFileSync(tokenFile, saved);
    expect(client.assembleInvitation(f.state, a.templateFile, out).assembled).toBe(true);
    expect(JSON.parse(readFileSync(out, "utf8")).token).toBe(JSON.parse(saved).token);
  });

  test("import --replace keeps a timestamped backup; plain import still refuses to overwrite", () => {
    const f = fixture(), live = join(f.state, "invitation.json"), original = readFileSync(live, "utf8");
    const nextGrant = "88888888-8888-4888-8888-888888888888";
    writeFileSync(f.invitationFile, JSON.stringify({ ...f.profile, grant_id: nextGrant }), { mode: 0o600 });
    expect(() => client.importInvitation(f.state, f.invitationFile)).toThrow();
    expect(readFileSync(live, "utf8")).toBe(original);
    const replaced = client.importInvitation(f.state, f.invitationFile, { replace: true });
    expect(replaced).toMatchObject({ mission_id: M, grant_id: nextGrant, imported: true, replaced: true });
    expect(replaced.backup).toMatch(/^invitation\.replaced-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z\.json$/);
    expect(readFileSync(join(f.state, replaced.backup!), "utf8")).toBe(original);
    expect(statSync(join(f.state, replaced.backup!)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(live, "utf8")).grant_id).toBe(nextGrant);
    expect(statSync(live).mode & 0o777).toBe(0o600);
    expect(client.participant(f.state).grant_id).toBe(nextGrant);
    const afterReplace = readFileSync(live, "utf8");
    for (const patch of [{ origin: "https://other.invalid" }, { expires_at: "2020-01-01T00:00:00.000Z" }, { token: "at_broad" }]) {
      writeFileSync(f.invitationFile, JSON.stringify({ ...f.profile, ...patch }));
      expect(() => client.importInvitation(f.state, f.invitationFile, { replace: true })).toThrow();
      expect(readFileSync(live, "utf8")).toBe(afterReplace);
    }
    expect(readdirSync(f.state).filter(name => name.startsWith(".invitation-"))).toEqual([]);
    rmSync(live); symlinkSync(join(f.state, replaced.backup!), live);
    writeFileSync(f.invitationFile, JSON.stringify(f.profile));
    expect(() => client.importInvitation(f.state, f.invitationFile, { replace: true })).toThrow();
    expect(readdirSync(f.state).filter(name => name.startsWith(".invitation-"))).toEqual([]);
    rmSync(live);
    expect(client.importInvitation(f.state, f.invitationFile, { replace: true })).toMatchObject({ grant_id: G, replaced: false, backup: null });
    const cli = run(["import", "--state", f.state, "--invitation-file", f.invitationFile, "--replace"], f.parent);
    expect(cli.status).toBe(0); expect(cli.stderr).toBe(""); expect(cli.stdout).not.toContain(TOKEN);
    expect(JSON.parse(cli.stdout)).toMatchObject({ grant_id: G, replaced: true });
    for (const args of [["--replace", "--replace"], ["--replace", "yes"]]) {
      const refused = run(["import", "--state", f.state, "--invitation-file", f.invitationFile, ...args], f.parent);
      expect(refused.status).toBe(1); expect(refused.stdout).toBe("");
    }
    expect(run(["invitation", "--state", f.state, "--replace"], f.parent).status).toBe(1);
  });

  test("leave signs the same exact-request proof, records the revocation once and never retries", async () => {
    const f = fixture(); const revokedAt = new Date().toISOString();
    const left = { mission_id: M, grant_id: G, status: "revoked", reason: "participant_left", revoked_at: revokedAt };
    let calls = 0;
    const result = await client.leave(f.state, { fetchImpl: async (url: string, init: RequestInit) => {
      calls++;
      const input = proofInput(url, init, TOKEN), headers = new Headers(init.headers);
      expect(url).toBe(`${ORIGIN}/v1/collaboration/missions/${M}/leave`);
      // Zero body bytes, as the service requires: no body, no Content-Type, and a proof over SHA-256("").
      expect(client.LEAVE_BODY).toBe(""); expect(init.method).toBe("POST"); expect(init.body).toBeUndefined();
      expect(input.bodyBytes).toHaveLength(0); expect(init.redirect).toBe("error");
      expect(headers.get("Authorization")).toBe(`Bearer ${TOKEN}`); expect(headers.get("Content-Type")).toBeNull();
      expect(Buffer.from(client.requestDigest(f.profile, "POST", input.requestTarget, "", input.proof.timestamp)))
        .toEqual(Buffer.from(canonicalMissionRequestBytes(input)));
      expect(verifyMissionProof(input, f.enrollment.public_key, new Date())).toBe(true);
      return response(left);
    } });
    expect(calls).toBe(1);
    expect(result).toEqual({ ...left, recorded: true });
    const record = join(f.state, `left-${G}.json`), saved = readFileSync(record, "utf8");
    expect(JSON.parse(saved)).toEqual(left); expect(statSync(record).mode & 0o777).toBe(0o600);
    // An idempotent repeat reads the recorded state and never overwrites the first local record.
    await client.leave(f.state, { fetchImpl: async () => response({ ...left, revoked_at: new Date(Date.now() + 1).toISOString() }) });
    expect(readFileSync(record, "utf8")).toBe(saved);
    for (const patch of [{ grant_id: E }, { mission_id: E }, { status: "active" }, { reason: "admin_revoked" }, { revoked_at: "yesterday" }]) {
      const other = fixture();
      await expect(client.leave(other.state, { fetchImpl: async () => response({ ...left, ...patch }) })).rejects.toThrow("does not match");
      expect(existsSync(join(other.state, `left-${G}.json`))).toBe(false);
    }
    const uncertain = fixture(); let attempts = 0, failure = "";
    try { await client.leave(uncertain.state, { fetchImpl: async () => { attempts++; throw new Error(`reset ${TOKEN}`); } }); }
    catch (error) { failure = String(error); }
    expect(attempts).toBe(1); expect(failure).toContain("Leave outcome is uncertain"); expect(failure).not.toContain(TOKEN);
    await expect(client.leave(uncertain.state, { fetchImpl: async () => response({ error: "collaboration_mission_invalid_credential" }, 401) }))
      .rejects.toThrow("HTTP 401 collaboration_mission_invalid_credential");
    expect(existsSync(join(uncertain.state, `left-${G}.json`))).toBe(false);
    // Leave never carries a body; accept and events never send an empty one.
    let refusedCalls = 0;
    const counted = { fetchImpl: async () => { refusedCalls++; return response({}); } };
    for (const [method, suffix, body] of [["GET", "/leave", ""], ["POST", "/leave", "{}"], ["POST", "/leave", " "],
      ["POST", "/accept", ""], ["POST", "/events", ""]]) {
      await expect(client.request(f.state, method, suffix, body, counted)).rejects.toThrow("Unsupported");
    }
    expect(refusedCalls).toBe(0);
  });

  test("the Node CLI carries a token hash from participant to administrator and back without printing secrets", () => {
    const f = fixture(false), a = admin(f);
    const created = run(["token-new", "--state", f.state], f.parent);
    expect(created.status).toBe(0);
    const { token_sha256: tokenSha256 } = JSON.parse(created.stdout), token = storedTokenText(f.state, tokenSha256);
    const marker = join(f.parent, "grant-requests.jsonl"), preload = join(f.parent, "synthetic-service.mjs");
    // Offline barrier: the CLI's only fetch is answered here; no real service or credential exists.
    writeFileSync(preload, `import { appendFileSync } from 'node:fs';
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  appendFileSync(${JSON.stringify(marker)}, JSON.stringify({ url, method: init.method, bearer: init.headers.Authorization === ${JSON.stringify(`Bearer ${BEARER}`)}, body }) + '\\n');
  const grant = { grant_id: body.grant_id, mission_id: ${JSON.stringify(M)}, project_id: '66666666-6666-4666-8666-666666666666',
    identity_id: body.identity_id, signing_key_id: body.signing_key_id, issuing_api_key_id: '77777777-7777-4777-8777-777777777777',
    origin: ${JSON.stringify(ORIGIN)}, actions: [...body.actions].sort(), issued_at: new Date().toISOString(), expires_at: body.expires_at,
    accepted_at: null, revoked_at: null };
  return new Response(JSON.stringify({ grant, token_sha256: body.token_sha256, token_source: 'participant' }), { status: 201 });
};
`, { mode: 0o600 });
    const grantArgs = ["grant", "--bearer-file", a.bearerFile, "--grant-file", a.requestFile, "--token-sha256", tokenSha256, "--template-file", a.templateFile];
    for (const extra of [[], ["--origin", "https://other.invalid"], ["--origin"]]) {
      const refused = run([...grantArgs, ...extra], a.dir, preload);
      expect(refused.status).toBe(1); expect(refused.stdout).toBe(""); expect(refused.stderr).not.toContain(BEARER);
      expect(existsSync(marker)).toBe(false); expect(existsSync(a.templateFile)).toBe(false);
    }
    const granted = run([...grantArgs, "--origin", ORIGIN], a.dir, preload);
    expect(granted.stderr).toBe(""); expect(granted.status).toBe(0);
    expect(JSON.parse(granted.stdout)).toMatchObject({ grant_id: G, token_sha256: tokenSha256, token_source: "participant", template_written: true });
    const sent = readFileSync(marker, "utf8").trim().split("\n").map(line => JSON.parse(line));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ url: `${ORIGIN}/v1/collaboration/missions/${M}/grants`, method: "POST", bearer: true });
    expect(sent[0].body.token_sha256).toBe(tokenSha256);
    expect(run(["grant", "--state", f.state, "--bearer-file", a.bearerFile], a.dir, preload).status).toBe(1);
    expect(readFileSync(marker, "utf8").trim().split("\n")).toHaveLength(1);
    const invitationFile = join(f.parent, "assembled.json");
    const assembled = run(["invitation-assemble", "--state", f.state, "--template-file", a.templateFile, "--invitation-file", invitationFile], f.parent);
    expect(assembled.status).toBe(0);
    expect(JSON.parse(assembled.stdout)).toMatchObject({ grant_id: G, token_sha256: tokenSha256, assembled: true });
    const imported = run(["import", "--state", f.state, "--invitation-file", invitationFile], f.parent);
    expect(imported.status).toBe(0);
    for (const output of [created, granted, assembled, imported]) {
      expect(output.stdout + output.stderr).not.toContain(token); expect(output.stdout + output.stderr).not.toContain(BEARER);
    }
    expect(client.participant(f.state)).toMatchObject({ grant_id: G, mission_id: M });
    const help = run(["--help"], f.parent);
    for (const command of ["token-new", "invitation-assemble", "--replace", "leave", "grant --bearer-file", "[--origin URL]"]) expect(help.stdout).toContain(command);
  });
});

// The API's real mission gateway and middleware, in process, with only its service layer
// replaced: the client's exact bytes, headers and proofs meet the API's own transport rules.
// The participant token-hash and /leave routes are a separate API change; these tests detect
// them in the checked-out API source. Before that change lands, the older-service tests show
// the client failing closed; afterwards, the contract tests run the whole flow.
const PROJECT = "66666666-6666-4666-8666-666666666666", API_KEY = "77777777-7777-4777-8777-777777777777";
const API_ACCEPTS_TOKEN_HASH = issueMissionGrantSchema.safeParse({ grant_id: G, identity_id: I, signing_key_id: K,
  actions: ["mission.read"], expires_at: new Date(Date.now() + 3_600_000).toISOString(), token_sha256: "0".repeat(64) }).success;
const API_HAS_LEAVE = (() => {
  try {
    return (missionOperation({ missionId: M, method: "POST", requestTarget: `/v1/collaboration/missions/${M}/leave`, bodyBytes: new Uint8Array() }) as { operation: string }).operation === "leave";
  } catch { return false; }
})();
function gatewayApp(service: Partial<MissionGatewayDependencies["service"]>) {
  const gateway = createMissionGateway({ origin: () => ORIGIN, service: service as MissionGatewayDependencies["service"],
    verify: (async (token: string) => token === BEARER ? { ok: true, project: { id: PROJECT }, apiKey: { id: API_KEY } } : { ok: false }) as any });
  const app = new Hono();
  app.use("*", collaborationTransportBoundary());
  app.use("*", earlyDataReplayProtection());
  app.use("*", apiCors());
  app.use("*", (c: any, next: () => Promise<void>) => isCollaborationPath(c.req.path) ? gateway(c) : next());
  app.all("*", (c: any) => c.json({ error: "outside_mission_gateway" }, 404));
  return { fetchImpl: async (url: string, init: RequestInit) => app.request(url, init) };
}

describe.skipIf(process.platform === "win32")("mission client through the API mission gateway", () => {
  test.skipIf(!API_ACCEPTS_TOKEN_HASH || !API_HAS_LEAVE)("token hash grant, assembly, acceptance and zero-byte leave pass the gateway", async () => {
    const f = fixture(false), a = admin(f), { token_sha256: tokenSha256 } = client.newToken(f.state);
    const issued: any[] = [], seen: Array<{ operation: string; bodyBytes: number }> = [];
    let acceptedAt: string | null = null, leftAt: string | null = null;
    const grant = () => ({ grant_id: G, mission_id: M, project_id: PROJECT, identity_id: I, signing_key_id: K, issuing_api_key_id: API_KEY,
      origin: ORIGIN, actions: ["mission.observe", "mission.read"], issued_at: new Date().toISOString(), expires_at: a.request.expires_at,
      accepted_at: acceptedAt, revoked_at: leftAt });
    const app = gatewayApp({
      issueMissionGrant: (async (input: any) => {
        issued.push(input);
        return { grant: { ...grant(), grant_id: input.grantId, actions: [...input.actions].sort(), expires_at: input.expiresAt },
          token_sha256: input.tokenSha256, token_source: "participant" };
      }) as any,
      executeMissionRequest: (async (input: any) => {
        // The API's own operation and body rules, then the stored hash and exact-request proof.
        const { operation } = missionOperation(input) as { operation: string };
        seen.push({ operation, bodyBytes: input.bodyBytes.length });
        if (missionSha256(input.token) !== tokenSha256 || input.origin !== ORIGIN || input.proof.grantId !== G || input.proof.identityId !== I
          || input.proof.keyId !== K || !verifyMissionProof(input, f.enrollment.public_key, new Date()) || (leftAt && operation !== "leave"))
          throw new MissionError("invalid_credential");
        const mission = { mission_id: M, descriptor, mission_digest: missionDigest };
        if (operation === "invitation") return { created: false, data: { mission, grant: grant() } };
        if (operation === "accept") { acceptedAt ??= new Date().toISOString(); return { created: true, data: { mission, grant: grant() } }; }
        if (operation === "leave") {
          if (!acceptedAt) throw new MissionError("acceptance_required");
          const created = leftAt === null; leftAt ??= new Date().toISOString();
          return { created, data: { mission_id: M, grant_id: G, status: "revoked", reason: "participant_left", revoked_at: leftAt } };
        }
        throw new MissionError("invalid_request");
      }) as any,
    });
    const result = await client.issueGrant({ bearerFile: a.bearerFile, requestFile: a.requestFile, tokenSha256, templateFile: a.templateFile, serviceOrigin: ORIGIN }, app);
    expect(result).toMatchObject({ grant_id: G, token_sha256: tokenSha256, token_source: "participant", template_written: true });
    expect(issued).toHaveLength(1);
    expect(issued[0]).toMatchObject({ projectId: PROJECT, missionId: M, issuerApiKeyId: API_KEY, grantId: G, tokenSha256, origin: ORIGIN });
    const invitationFile = join(f.parent, "assembled-invitation.json");
    client.assembleInvitation(f.state, a.templateFile, invitationFile); client.importInvitation(f.state, invitationFile);
    // Membership begins at acceptance: an unaccepted grant cannot leave.
    await expect(client.leave(f.state, app)).rejects.toThrow("HTTP 403 collaboration_mission_acceptance_required");
    expect(existsSync(join(f.state, `left-${G}.json`))).toBe(false);
    await client.accept(f.state, missionDigest, app);
    const left = await client.leave(f.state, app);
    expect(left).toEqual({ mission_id: M, grant_id: G, status: "revoked", reason: "participant_left", revoked_at: leftAt!, recorded: true });
    expect(JSON.parse(readFileSync(join(f.state, `left-${G}.json`), "utf8")).revoked_at).toBe(leftAt!);
    expect(await client.leave(f.state, app)).toEqual(left);
    expect(seen.filter(entry => entry.operation === "leave")).toEqual(Array.from({ length: 3 }, () => ({ operation: "leave", bodyBytes: 0 })));
    expect(seen.map(entry => entry.operation)).toEqual(["leave", "invitation", "accept", "leave", "leave"]);
  });

  test.skipIf(API_HAS_LEAVE)("against a service without /leave, leave fails closed and records nothing", async () => {
    const f = fixture(); let called = 0;
    const app = gatewayApp({ executeMissionRequest: (async () => { called++; throw new Error("unreachable"); }) as any });
    await expect(client.leave(f.state, app)).rejects.toThrow("HTTP 404 mission_route_not_found");
    expect(called).toBe(0); expect(existsSync(join(f.state, `left-${G}.json`))).toBe(false);
  });

  test.skipIf(API_ACCEPTS_TOKEN_HASH)("against a service without token_sha256, grant is refused and writes no template", async () => {
    const f = fixture(false), a = admin(f), { token_sha256: tokenSha256 } = client.newToken(f.state); let called = 0;
    const app = gatewayApp({ issueMissionGrant: (async () => { called++; throw new Error("unreachable"); }) as any });
    await expect(client.issueGrant({ bearerFile: a.bearerFile, requestFile: a.requestFile, tokenSha256, templateFile: a.templateFile, serviceOrigin: ORIGIN }, app))
      .rejects.toThrow("HTTP 400 invalid_mission_grant_request");
    expect(called).toBe(0); expect(existsSync(a.templateFile)).toBe(false);
  });
});
