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
import { canonicalMissionRequestBytes, verifyMissionProof } from "../../api/src/services/collaboration/proof";
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
function run(args: string[], cwd: string) {
  return spawnSync(NODE, [CLI, ...args], { cwd, env: { PATH: process.env.PATH ?? "", HOME: cwd, TMPDIR: tmpdir() },
    encoding: "utf8", timeout: 5000, maxBuffer: 256 * 1024 });
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
