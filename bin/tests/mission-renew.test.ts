/** Participant renewal and administrator window commands against synthetic fetch fixtures:
 * no live service, real bearer or host credentials. Contract: docs/COLLABORATION-MISSION-CLIENT.md. */
import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { Hono } from "../../api/node_modules/hono/dist/index.js";
import { createMissionGateway, type MissionGatewayDependencies } from "../../api/src/routes/collaboration";
import { collaborationTransportBoundary, isCollaborationPath } from "../../api/src/middleware/collaboration-boundary";
import { earlyDataReplayProtection } from "../../api/src/middleware/early-data";
import { apiCors } from "../../api/src/middleware/api-cors";
import { MissionError, missionOperation, missionRenewSchema, parseMissionBody, parseMissionInput } from "../../api/src/services/collaboration/contracts";
import { verifyMissionProof } from "../../api/src/services/collaboration/proof";
import { correspondenceCanonicalJson } from "../../api/src/services/correspondence/canonical";
import * as client from "../agenttool-mission.mjs";

const M = "11111111-1111-4111-8111-111111111111", G = "22222222-2222-4222-8222-222222222222";
const I = "33333333-3333-4333-8333-333333333333", K = "44444444-4444-4444-8444-444444444444";
const PROJECT = "66666666-6666-4666-8666-666666666666", API_KEY = "77777777-7777-4777-8777-777777777777";
const ORIGIN = "https://mission-fixture.invalid";
const TOKEN = `atcm_${Buffer.alloc(32, 23).toString("base64url")}`;
// Clearly synthetic administrator bearer: it never reaches a real service.
const BEARER = "at_synthetic_fixture_bearer_not_a_credential";
const CLI = resolve(import.meta.dir, "../agenttool-mission.mjs");
const NODE = Bun.which("node")!;
const MIN = 60_000;
const cleanups: Array<() => unknown> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const iso = (ms: number) => new Date(ms).toISOString();
const descriptor = { format: "agenttool-collaboration-mission/v1", purpose: "Exchange selected fixture observations", resources: [], acceptance_criteria: ["Return one reviewed reply"], principalities: [] };
const DIGEST = `sha256:${sha(correspondenceCanonicalJson(descriptor))}`;
const mission = { mission_id: M, project_id: PROJECT, descriptor, mission_digest: DIGEST };

/** A participant whose imported grant G is accepted, a quarter past its halfway, inside a six-hour window. */
function fixture(grant: Record<string, unknown> = {}) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), "mission-renew-fixture-")));
  chmodSync(parent, 0o700);
  cleanups.push(() => rmSync(parent, { recursive: true, force: true }));
  const state = join(parent, "state"), enrollment = client.init(state, ORIGIN), now = Date.now();
  const predecessor: Record<string, any> = { grant_id: G, mission_id: M, project_id: PROJECT, identity_id: I, signing_key_id: K,
    issuing_api_key_id: API_KEY, origin: ORIGIN, actions: ["mission.observe", "mission.read"], issued_at: iso(now - 40 * MIN),
    expires_at: iso(now + 20 * MIN), accepted_at: iso(now - 39 * MIN), revoked_at: null,
    renewal: { root_grant_id: G, renewed_from_grant_id: null, renewed_to_grant_id: null, renewable_until: iso(now + 6 * 3_600_000), closed_at: null }, ...grant };
  const file = join(parent, "invitation.json");
  writeFileSync(file, JSON.stringify({ format: "agenttool-mission-invitation/v1", origin: ORIGIN, mission_id: M, grant_id: G, identity_id: I,
    signing_key_id: K, public_key: enrollment.public_key, expires_at: predecessor.expires_at, token: TOKEN }), { mode: 0o600 });
  client.importInvitation(state, file);
  return { parent, state, enrollment, predecessor };
}
type Mode = "ok" | "store-then-drop" | "drop" | "401" | "409" | "403" | "500" | "400" | "token_hash_conflict";
/** A synthetic service: verifies each request's token and exact-request proof, stores successors, answers probes. */
function service(f: ReturnType<typeof fixture>, renewMode: Mode | Mode[] = "ok", patch: (view: any) => void = () => {}) {
  const hashes = new Map<string, string>([[G, sha(TOKEN)]]), children = new Map<string, any>();
  const calls: Array<{ method: string; path: string; grant: string; body: string | undefined; headers: Headers }> = [];
  const modes = Array.isArray(renewMode) ? [...renewMode] : [renewMode];
  const respond = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
  const fetchImpl = async (url: string, init: RequestInit) => {
    const headers = new Headers(init.headers), path = new URL(url).pathname, grant = headers.get("X-Agenttool-Mission-Grant-Id")!;
    const body = init.body === undefined ? undefined : String(init.body);
    calls.push({ method: String(init.method), path, grant, body, headers });
    const token = headers.get("Authorization")!.slice(7);
    const input = { token, origin: ORIGIN, method: String(init.method), missionId: M, requestTarget: path, bodyBytes: Buffer.from(body ?? ""),
      proof: { grantId: grant, identityId: headers.get("X-Agenttool-Mission-Identity-Id")!, keyId: headers.get("X-Agenttool-Mission-Key-Id")!,
        timestamp: headers.get("X-Agenttool-Mission-Timestamp")!, signature: headers.get("X-Agenttool-Mission-Signature")! } };
    if (hashes.get(grant) !== sha(token) || !verifyMissionProof(input, f.enrollment.public_key, new Date())) return respond({ error: "collaboration_mission_invalid_credential" }, 401);
    if (init.method === "GET") return respond({ mission, grant: grant === G ? f.predecessor : children.get(grant) });
    const mode = modes.length > 1 ? modes.shift()! : modes[0];
    const parsed = JSON.parse(body!);
    const existing = [...children.values()][0];
    if (existing && (existing.grant_id !== parsed.grant_id || existing.body !== body)) return respond({ error: "collaboration_mission_conflict" }, 409);
    const child = existing ?? { grant_id: parsed.grant_id, mission_id: M, project_id: PROJECT, identity_id: I, signing_key_id: K, issuing_api_key_id: API_KEY,
      origin: ORIGIN, actions: [...f.predecessor.actions], issued_at: iso(Date.now()), accepted_at: iso(Date.now()), expires_at: iso(Date.now() + 3_600_000), revoked_at: null,
      renewal: { root_grant_id: G, renewed_from_grant_id: G, renewed_to_grant_id: null, renewable_until: f.predecessor.renewal.renewable_until, closed_at: null }, body };
    const store = () => { children.set(child.grant_id, child); hashes.set(child.grant_id, parsed.token_sha256); };
    if (mode === "drop") throw new Error(`socket closed ${token}`);
    if (mode === "store-then-drop") { store(); throw new Error(`socket closed ${token}`); }
    if (mode === "401") return respond({ error: "collaboration_mission_invalid_credential" }, 401);
    if (mode === "409") return respond({ error: "collaboration_mission_conflict" }, 409);
    if (mode === "403") return respond({ error: "collaboration_mission_renewal_unavailable" }, 403);
    if (mode === "500") return respond({ error: "mission_unavailable" }, 503);
    if (mode === "400") return respond({ error: "collaboration_mission_invalid_request" }, 400);
    if (mode === "token_hash_conflict") return respond({ error: "token_hash_conflict" }, 409);
    store();
    const { body: _, ...view } = child;
    const result = { mission: structuredClone(mission), grant: structuredClone(view), token_sha256: parsed.token_sha256, token_source: "participant" };
    patch(result);
    return respond(result, existing ? 200 : 201);
  };
  return { fetchImpl, calls, children, hashes };
}
const invitationFile = (f: ReturnType<typeof fixture>) => JSON.parse(readFileSync(join(f.state, "invitation.json"), "utf8"));
const pendingFile = (f: ReturnType<typeof fixture>) => join(f.state, "renewal-pending.json");
async function stop(promise: Promise<unknown>) {
  const error = await promise.then(() => null, reason => reason);
  expect(error).toBeInstanceOf(client.RenewalError);
  return error as InstanceType<typeof client.RenewalError> & { stop_reason: string; delivered: unknown; next: string; serviceCode: string | null };
}
/** Lapse the predecessor locally: renewal then recovers only by signing as the successor. */
function lapse(f: ReturnType<typeof fixture>) {
  writeFileSync(join(f.state, "invitation.json"), JSON.stringify({ ...invitationFile(f), expires_at: iso(Date.now() - 1000) }), { mode: 0o600 });
}
function run(args: string[], cwd: string, preload?: string) {
  return spawnSync(NODE, [...(preload ? ["--import", preload] : []), CLI, ...args], { cwd, env: { PATH: process.env.PATH ?? "", HOME: cwd, TMPDIR: tmpdir() },
    encoding: "utf8", timeout: 10_000, maxBuffer: 256 * 1024 });
}

describe.skipIf(process.platform === "win32")("participant renew", () => {
  test("a fresh renew saves the exact body first, posts it once, validates and installs the successor with a backup", async () => {
    const f = fixture(), s = service(f);
    let pendingAtSend: any = null;
    const fetchImpl = async (url: string, init: RequestInit) => {
      if (init.method === "POST") pendingAtSend = JSON.parse(readFileSync(pendingFile(f), "utf8"));
      return s.fetchImpl(url, init);
    };
    const result = await client.renew(f.state, { fetchImpl });
    expect(s.calls.map(c => `${c.method} ${c.path.split("/").at(-1)} as ${c.grant === G ? "G" : "child"}`)).toEqual(["GET invitation as G", "POST renew as G"]);
    const post = s.calls[1], sent = JSON.parse(post.body!);
    expect(Object.keys(sent).sort()).toEqual(["grant_id", "mission_digest", "token_sha256"]);
    expect(sent.mission_digest).toBe(DIGEST);
    expect(post.headers.get("Content-Type")).toBe("application/json");
    expect(pendingAtSend).toMatchObject({ format: "agenttool-mission-renewal-pending/v1", mission_id: M, predecessor_grant_id: G,
      grant_id: sent.grant_id, token_sha256: sent.token_sha256, body_utf8: post.body });
    const child = s.children.get(sent.grant_id);
    expect(result).toEqual({ mission_id: M, renewed_from_grant_id: G, grant_id: sent.grant_id, expires_at: child.expires_at,
      renewable_until: f.predecessor.renewal.renewable_until, renewed: true, replaced: true, backup: expect.stringMatching(/^invitation\.replaced-.*\.json$/),
      note: "Peers whose chat config pins this grant_id must re-pin by identity_id and signing_key_id." });
    expect(JSON.stringify(result)).not.toContain("atcm_");
    expect(existsSync(pendingFile(f))).toBe(false);
    const installed = invitationFile(f);
    expect(installed).toMatchObject({ grant_id: sent.grant_id, expires_at: child.expires_at, mission_id: M, identity_id: I, signing_key_id: K });
    expect(sha(installed.token)).toBe(sent.token_sha256);
    expect(JSON.parse(readFileSync(join(f.state, result.backup), "utf8")).grant_id).toBe(G);
    expect(client.participant(f.state).grant_id).toBe(sent.grant_id);
  });

  test("an uncertain send keeps the record; the next run resends byte-identical bytes and installs the stored successor", async () => {
    const f = fixture(), s = service(f, ["store-then-drop", "ok"]);
    const uncertain = await stop(client.renew(f.state, { fetchImpl: s.fetchImpl }));
    expect(uncertain).toMatchObject({ stop_reason: "renewal_uncertain", delivered: "unknown", next: "run renew again to resend the same request" });
    expect(String(uncertain.message)).not.toContain("atcm_");
    expect(existsSync(pendingFile(f))).toBe(true);
    expect(invitationFile(f).grant_id).toBe(G);
    const first = s.calls[1].body;
    const result = await client.renew(f.state, { fetchImpl: s.fetchImpl });
    expect(s.calls.map(c => c.method)).toEqual(["GET", "POST", "GET", "POST"]);
    expect(s.calls[3].body).toBe(first);
    expect(s.calls[3].headers.get("X-Agenttool-Mission-Timestamp")).not.toBeNull();
    expect(result).toMatchObject({ renewed: true, grant_id: JSON.parse(first!).grant_id });
    expect(existsSync(pendingFile(f))).toBe(false);
  });

  test("after the predecessor lapses, a successor-signed invitation read recovers it; an unrecorded one is abandoned", async () => {
    const f = fixture(), s = service(f, "store-then-drop");
    await stop(client.renew(f.state, { fetchImpl: s.fetchImpl }));
    const child = JSON.parse(s.calls[1].body!).grant_id;
    lapse(f);
    const result = await client.renew(f.state, { fetchImpl: s.fetchImpl });
    const probe = s.calls[2];
    expect(s.calls).toHaveLength(3);
    expect(probe).toMatchObject({ method: "GET", grant: child });
    expect(probe.path).toBe(`/v1/collaboration/missions/${M}/invitation`);
    expect(sha(probe.headers.get("Authorization")!.slice(7))).toBe(s.hashes.get(child));
    expect(result).toMatchObject({ renewed: true, grant_id: child, renewed_from_grant_id: G });

    const g = fixture(), lost = service(g, "drop");
    await stop(client.renew(g.state, { fetchImpl: lost.fetchImpl }));
    const pending = JSON.parse(readFileSync(pendingFile(g), "utf8"));
    lapse(g);
    const abandoned = await stop(client.renew(g.state, { fetchImpl: lost.fetchImpl }));
    expect(abandoned).toMatchObject({ stop_reason: "renewal_abandoned", delivered: false });
    expect(abandoned.next).toContain("ask the administrator for a new grant");
    expect(existsSync(pendingFile(g))).toBe(false);
    expect(JSON.parse(readFileSync(join(g.state, `renewal-abandoned-${pending.grant_id}.json`), "utf8"))).toEqual(pending);
    expect(invitationFile(g).grant_id).toBe(G);
  });

  test("a record left after a completed install is only cleaned up", async () => {
    const f = fixture(), s = service(f);
    let saved = "";
    await client.renew(f.state, { fetchImpl: async (url: string, init: RequestInit) => {
      if (init.method === "POST") saved = readFileSync(pendingFile(f), "utf8");
      return s.fetchImpl(url, init);
    } });
    writeFileSync(pendingFile(f), saved, { mode: 0o600 });
    const calls = s.calls.length;
    expect(await client.renew(f.state, { fetchImpl: s.fetchImpl })).toMatchObject({ renewed: true, already_installed: true, grant_id: JSON.parse(saved).grant_id });
    expect(s.calls).toHaveLength(calls);
    expect(existsSync(pendingFile(f))).toBe(false);
  });

  test("a conflict the successor read cannot confirm is reported as possible theft; nothing changes", async () => {
    const f = fixture(), s = service(f, "409");
    const before = readFileSync(join(f.state, "invitation.json"), "utf8");
    const conflict = await stop(client.renew(f.state, { fetchImpl: s.fetchImpl }));
    expect(conflict.stop_reason).toBe("renewal_conflict");
    expect(conflict.serviceCode).toBe("collaboration_mission_conflict");
    expect(conflict.next).toContain(`Grant ${G} was already renewed by a request this device did not record`);
    expect(conflict.next).toContain("run leave (it ends every grant in the chain)");
    expect(s.calls.map(c => `${c.method} ${c.grant === G ? "G" : "child"}`)).toEqual(["GET G", "POST G", "GET child"]);
    expect(readFileSync(join(f.state, "invitation.json"), "utf8")).toBe(before);
    expect(existsSync(pendingFile(f))).toBe(true);
  });

  test("a closed window after sending abandons the record; definitive refusals never loop", async () => {
    for (const [mode, reason, abandoned] of [["403", "renewal_unavailable", true], ["token_hash_conflict", "renewal_refused", true],
      ["400", "renewal_refused", true], ["500", "renewal_uncertain", false]] as const) {
      const f = fixture(), s = service(f, mode);
      const error = await stop(client.renew(f.state, { fetchImpl: s.fetchImpl }));
      expect(error.stop_reason, mode).toBe(reason);
      expect(existsSync(pendingFile(f)), mode).toBe(!abandoned);
      expect(readdirSync(f.state).some(name => name.startsWith("renewal-abandoned-")), mode).toBe(abandoned);
      expect(invitationFile(f).grant_id).toBe(G);
    }
  });

  test("not yet open prints when it opens and sends nothing beyond the read", async () => {
    const now = Date.now();
    const f = fixture({ issued_at: iso(now - 10 * MIN), expires_at: iso(now + 20 * MIN) }), s = service(f);
    expect(await client.renew(f.state, { fetchImpl: s.fetchImpl })).toEqual({ renewed: false, reason: "not_yet_open",
      opens_at: iso(now + 5 * MIN), expires_at: iso(now + 20 * MIN) });
    expect(s.calls.map(c => c.method)).toEqual(["GET"]);
    expect(existsSync(pendingFile(f))).toBe(false);
    expect(existsSync(join(f.state, "tokens"))).toBe(false);
  });

  test("no window, a closed or ended window, or an unaccepted grant is refused before any POST", async () => {
    const now = Date.now();
    for (const [patch, reason] of [
      [{ renewal: undefined }, "renewal_unavailable"],
      [{ renewal: { root_grant_id: G, renewed_from_grant_id: null, renewed_to_grant_id: null, renewable_until: iso(now + 3_600_000), closed_at: iso(now - MIN) } }, "renewal_unavailable"],
      [{ renewal: { root_grant_id: G, renewed_from_grant_id: null, renewed_to_grant_id: null, renewable_until: iso(now + 20 * MIN), closed_at: null } }, "renewal_unavailable"],
      [{ renewal: { root_grant_id: G, renewed_from_grant_id: null, renewed_to_grant_id: null, renewable_until: iso(now - 1), closed_at: null } }, "renewal_unavailable"],
      [{ accepted_at: null }, "renewal_refused"],
    ] as Array<[Record<string, unknown>, string]>) {
      const f = fixture(patch), s = service(f);
      if (!patch.renewal && "renewal" in patch) delete f.predecessor.renewal;
      const error = await stop(client.renew(f.state, { fetchImpl: s.fetchImpl }));
      expect(error.stop_reason).toBe(reason);
      expect(s.calls.map(c => c.method)).toEqual(["GET"]);
      expect(existsSync(pendingFile(f))).toBe(false);
    }
  });

  test("any successor that does not match the predecessor's scope, window or echo is never installed", async () => {
    const now = Date.now();
    for (const [name, patch] of [
      ["token", (v: any) => { v.grant.token = TOKEN; }],
      ["nested-token", (v: any) => { v.token = TOKEN; }],
      ["renewed-from", (v: any) => { v.grant.renewal.renewed_from_grant_id = "55555555-5555-4555-8555-555555555555"; }],
      ["other-id", (v: any) => { v.grant.grant_id = "55555555-5555-4555-8555-555555555555"; }],
      ["widened", (v: any) => { v.grant.actions = ["mission.observe", "mission.read", "mission.admin"]; }],
      ["narrowed", (v: any) => { v.grant.actions = ["mission.read"]; }],
      ["beyond-window", (v: any) => { v.grant.expires_at = iso(Date.parse(v.grant.renewal.renewable_until) + 1); }],
      ["window-widened", (v: any) => { v.grant.renewal.renewable_until = iso(now + 7 * 3_600_000); }],
      ["not-extending", (v: any) => { v.grant.expires_at = iso(now + 20 * MIN); }],
      ["digest", (v: any) => { v.mission.mission_digest = `sha256:${"0".repeat(64)}`; }],
      ["revoked", (v: any) => { v.grant.revoked_at = iso(now); }],
      ["unaccepted", (v: any) => { v.grant.accepted_at = null; }],
      ["other-key", (v: any) => { v.grant.signing_key_id = "55555555-5555-4555-8555-555555555555"; }],
      ["echo", (v: any) => { v.token_sha256 = "0".repeat(64); }],
      ["source", (v: any) => { v.token_source = "server"; }],
    ] as Array<[string, (view: any) => void]>) {
      const f = fixture(), s = service(f, "ok", patch);
      const before = readFileSync(join(f.state, "invitation.json"), "utf8");
      const error = await stop(client.renew(f.state, { fetchImpl: s.fetchImpl }));
      expect(error.stop_reason, name).toBe("renewal_response_invalid");
      expect(readFileSync(join(f.state, "invitation.json"), "utf8"), name).toBe(before);
      expect(existsSync(pendingFile(f)), name).toBe(true);
      expect(String(error.message), name).not.toContain("atcm_");
    }
  });

  test("a second run while a record is pending resends rather than starting another renewal", async () => {
    const f = fixture(), s = service(f, ["drop", "drop"]);
    await stop(client.renew(f.state, { fetchImpl: s.fetchImpl }));
    await stop(client.renew(f.state, { fetchImpl: s.fetchImpl }));
    expect(s.calls[1].body).toBe(s.calls[3].body);
    expect(readdirSync(join(f.state, "tokens"))).toHaveLength(1);
  });

  test("the request whitelist admits only a nonempty bounded renew body", async () => {
    const f = fixture();
    let calls = 0;
    const options = { fetchImpl: async () => { calls++; return new Response("{}"); } };
    for (const [method, suffix, body] of [["POST", "/renew", ""], ["POST", "/renew", "x".repeat(8193)], ["GET", "/renew", ""],
      ["POST", "/renew/", "{}"], ["POST", "/grants", "{}"], ["POST", `/grants/${G}/renewal/close`, ""], ["POST", "/revoke", ""]] as const) {
      await expect(client.request(f.state, method, suffix, body, options)).rejects.toThrow("Unsupported participant operation.");
    }
    expect(calls).toBe(0);
  });

  test("a mismatched pending record stops without sending", async () => {
    const f = fixture();
    writeFileSync(pendingFile(f), JSON.stringify({ format: "agenttool-mission-renewal-pending/v1", mission_id: M, predecessor_grant_id: "55555555-5555-4555-8555-555555555555",
      grant_id: "99999999-9999-4999-8999-999999999999", token_sha256: "a".repeat(64), created_at: iso(Date.now()),
      body_utf8: JSON.stringify({ grant_id: "99999999-9999-4999-8999-999999999999", mission_digest: DIGEST, token_sha256: "a".repeat(64) }) }), { mode: 0o600 });
    const s = service(f);
    expect((await stop(client.renew(f.state, { fetchImpl: s.fetchImpl }))).stop_reason).toBe("renewal_pending_mismatch");
    expect(s.calls).toHaveLength(0);
  });
});

describe.skipIf(process.platform === "win32")("administrator window commands", () => {
  function admin(f: ReturnType<typeof fixture>) {
    const dir = join(f.parent, "admin"); mkdirSync(dir, { mode: 0o700 });
    const bearerFile = join(dir, "bearer"); writeFileSync(bearerFile, `${BEARER}\n`, { mode: 0o600 });
    const request = { format: "agenttool-mission-grant-request/v1", origin: ORIGIN, mission_id: M, grant_id: G, identity_id: I,
      signing_key_id: K, public_key: f.enrollment.public_key, actions: ["mission.observe", "mission.read"], expires_at: iso(Date.now() + 3_600_000) };
    const requestFile = join(dir, "grant-request.json"); writeFileSync(requestFile, JSON.stringify(request), { mode: 0o600 });
    return { dir, bearerFile, request, requestFile, templateFile: join(dir, "invitation-template.json") };
  }
  const issued = (request: any, body: any, renewal?: unknown) => ({ grant: { grant_id: request.grant_id, mission_id: M, project_id: PROJECT, identity_id: I,
    signing_key_id: K, issuing_api_key_id: API_KEY, origin: ORIGIN, actions: [...request.actions].sort(), issued_at: iso(Date.now()), expires_at: request.expires_at,
    accepted_at: null, revoked_at: null, ...(renewal === undefined ? {} : { renewal }) }, token_sha256: body.token_sha256, token_source: "participant" });

  test("grant --renewable-until adds only that field and requires its echo; without it the body is unchanged", async () => {
    const f = fixture(), a = admin(f), tokenSha256 = "c".repeat(64), until = iso(Date.now() + 6 * 3_600_000);
    const bodies: string[] = [];
    const answer = (renewal: (body: any) => unknown) => ({ fetchImpl: async (_url: string, init: RequestInit) => {
      bodies.push(String(init.body)); const body = JSON.parse(String(init.body));
      return new Response(JSON.stringify(issued(a.request, body, renewal(body))), { status: 201 });
    } });
    const window = { root_grant_id: G, renewed_from_grant_id: null, renewed_to_grant_id: null, renewable_until: until, closed_at: null };
    const result = await client.issueGrant({ bearerFile: a.bearerFile, requestFile: a.requestFile, tokenSha256, templateFile: a.templateFile, serviceOrigin: ORIGIN, renewableUntil: until }, answer(() => window));
    expect(result).toMatchObject({ grant_id: G, renewable_until: until, template_written: true });
    expect(JSON.parse(bodies[0])).toEqual({ grant_id: G, identity_id: I, signing_key_id: K, actions: a.request.actions, expires_at: a.request.expires_at, token_sha256: tokenSha256, renewable_until: until });
    // The template format is unchanged.
    expect(Object.keys(JSON.parse(readFileSync(a.templateFile, "utf8"))).sort()).toEqual(["expires_at", "format", "grant_id", "identity_id", "mission_id", "origin", "public_key", "signing_key_id", "token_sha256"]);
    rmSync(a.templateFile);
    const plain = await client.issueGrant({ bearerFile: a.bearerFile, requestFile: a.requestFile, tokenSha256, templateFile: a.templateFile, serviceOrigin: ORIGIN }, answer(() => undefined));
    // Byte-identical to the request this client sent before renewal existed.
    expect(bodies[1]).toBe(JSON.stringify({ grant_id: G, identity_id: I, signing_key_id: K, actions: a.request.actions, expires_at: a.request.expires_at, token_sha256: tokenSha256 }));
    expect(plain).not.toHaveProperty("renewable_until");
    for (const [flag, renewal] of [[until, () => undefined], [until, () => ({ ...window, renewable_until: iso(Date.parse(until) + 1) })],
      [until, () => ({ ...window, closed_at: iso(Date.now()) })], [until, () => ({ ...window, renewed_from_grant_id: K })], [undefined, () => window]] as const) {
      rmSync(a.templateFile, { force: true });
      await expect(client.issueGrant({ bearerFile: a.bearerFile, requestFile: a.requestFile, tokenSha256, templateFile: a.templateFile, serviceOrigin: ORIGIN,
        ...(flag === undefined ? {} : { renewableUntil: flag }) }, answer(renewal))).rejects.toThrow("does not confirm the renewal window");
      expect(existsSync(a.templateFile)).toBe(false);
    }
    const sent = bodies.length;
    for (const flag of ["2026-10-27T12:00:00Z", a.request.expires_at, iso(Date.now() + 31 * 86_400_000), "soon"]) {
      await expect(client.issueGrant({ bearerFile: a.bearerFile, requestFile: a.requestFile, tokenSha256, templateFile: a.templateFile, serviceOrigin: ORIGIN, renewableUntil: flag }, answer(() => window)))
        .rejects.toThrow("--renewable-until");
    }
    expect(bodies).toHaveLength(sent);
  });

  test("renewal-close pins the origin before reading the bearer, sends zero bytes and reports the window", async () => {
    const f = fixture(), a = admin(f), calls: Array<{ url: string; init: RequestInit }> = [];
    const closedAt = iso(Date.now());
    const result = await client.closeRenewal({ bearerFile: a.bearerFile, missionId: M, grantId: G, serviceOrigin: ORIGIN }, { fetchImpl: async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ grant: { grant_id: G, mission_id: M, renewal: { root_grant_id: G, renewed_from_grant_id: null, renewed_to_grant_id: null, renewable_until: iso(Date.now() + 3_600_000), closed_at: closedAt } } }));
    } });
    expect(result).toEqual({ grant_id: G, renewable: true, root_grant_id: G, closed_at: closedAt });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${ORIGIN}/v1/collaboration/missions/${M}/grants/${G}/renewal/close`);
    expect(calls[0].init).toMatchObject({ method: "POST", redirect: "error" });
    expect(calls[0].init.body).toBeUndefined();
    expect(new Headers(calls[0].init.headers).get("Content-Type")).toBeNull();
    expect(new Headers(calls[0].init.headers).get("Authorization")).toBe(`Bearer ${BEARER}`);
    const plain = await client.closeRenewal({ bearerFile: a.bearerFile, missionId: M, grantId: G, serviceOrigin: ORIGIN }, { fetchImpl: async () => new Response(JSON.stringify({ grant: { grant_id: G, mission_id: M } })) });
    expect(plain).toEqual({ grant_id: G, renewable: false, root_grant_id: null, closed_at: null });
    // A wrong origin is refused even when the bearer file could not be read at all.
    let fetched = 0;
    for (const serviceOrigin of ["http://mission-fixture.invalid", `${ORIGIN}/`]) {
      await expect(client.closeRenewal({ bearerFile: join(a.dir, "missing"), missionId: M, grantId: G, serviceOrigin }, { fetchImpl: async () => { fetched++; return new Response("{}"); } }))
        .rejects.toThrow("pinned HTTPS origin");
    }
    expect(fetched).toBe(0);
    const uncertain = await stop(client.closeRenewal({ bearerFile: a.bearerFile, missionId: M, grantId: G, serviceOrigin: ORIGIN }, { fetchImpl: async () => { throw new Error(`reset ${BEARER}`); } }));
    expect(uncertain).toMatchObject({ stop_reason: "renewal_close_uncertain", delivered: "unknown", next: "repeat renewal-close; it is idempotent" });
    expect(String(uncertain.message)).not.toContain(BEARER);
    await expect(client.closeRenewal({ bearerFile: a.bearerFile, missionId: M, grantId: G, serviceOrigin: ORIGIN }, { fetchImpl: async () => new Response(JSON.stringify({ grant: { grant_id: K, mission_id: M } })) }))
      .rejects.toThrow("does not confirm the window close");
  });

  test("the CLI prints one structured stop on stderr, never a token or bearer, and renew succeeds offline", () => {
    const f = fixture(), a = admin(f), marker = join(f.parent, "calls.jsonl"), preload = join(f.parent, "synthetic-service.mjs");
    writeFileSync(preload, `import { appendFileSync } from 'node:fs';
const predecessor = ${JSON.stringify(f.predecessor)}, mission = ${JSON.stringify(mission)};
globalThis.fetch = async (url, init) => {
  const path = new URL(url).pathname;
  appendFileSync(${JSON.stringify(marker)}, JSON.stringify({ origin: new URL(url).origin, path, method: init.method, body: init.body ?? null }) + '\\n');
  if (process.env.MISSION_FIXTURE_MODE === 'drop' && init.method === 'POST') throw new Error('socket closed ' + init.headers.Authorization);
  if (path.endsWith('/renewal/close')) return new Response(JSON.stringify({ grant: { grant_id: ${JSON.stringify(G)}, mission_id: ${JSON.stringify(M)} } }));
  if (init.method === 'GET') return new Response(JSON.stringify({ mission, grant: predecessor }));
  const body = JSON.parse(init.body), now = Date.now();
  const grant = { ...predecessor, grant_id: body.grant_id, issued_at: new Date(now).toISOString(), accepted_at: new Date(now).toISOString(),
    expires_at: new Date(now + 3600000).toISOString(), renewal: { ...predecessor.renewal, renewed_from_grant_id: predecessor.grant_id } };
  return new Response(JSON.stringify({ mission, grant, token_sha256: body.token_sha256, token_source: 'participant' }), { status: 201 });
};
`, { mode: 0o600 });
    const env = (mode: string) => ({ PATH: process.env.PATH ?? "", HOME: f.parent, TMPDIR: tmpdir(), MISSION_FIXTURE_MODE: mode });
    const cli = (args: string[], mode = "ok") => spawnSync(NODE, ["--import", preload, CLI, ...args], { cwd: f.parent, env: env(mode), encoding: "utf8", timeout: 10_000 });
    const dropped = cli(["renew", "--state", f.state], "drop");
    expect(dropped.status).toBe(1); expect(dropped.stdout).toBe("");
    const stopped = JSON.parse(dropped.stderr);
    expect(stopped).toEqual({ stop_reason: "renewal_uncertain", error: "Renewal outcome is uncertain; the exact request remains saved.", code: null,
      delivered: "unknown", retry: "never automatic", next: "run renew again to resend the same request" });
    const renewed = cli(["renew", "--state", f.state]);
    expect(renewed.stderr).toBe(""); expect(renewed.status).toBe(0);
    expect(JSON.parse(renewed.stdout)).toMatchObject({ renewed: true, renewed_from_grant_id: G, replaced: true });
    const closed = cli(["renewal-close", "--bearer-file", a.bearerFile, "--mission-id", M, "--grant-id", G, "--origin", ORIGIN]);
    expect(closed.stderr).toBe(""); expect(JSON.parse(closed.stdout)).toEqual({ grant_id: G, renewable: false, root_grant_id: null, closed_at: null });
    // Without --origin the bearer goes only to the default service (intercepted here; nothing leaves the machine).
    const unpinned = cli(["renewal-close", "--bearer-file", a.bearerFile, "--mission-id", M, "--grant-id", G]);
    expect(unpinned.status).toBe(0);
    const calls = readFileSync(marker, "utf8").trim().split("\n").map(line => JSON.parse(line));
    expect(calls.map(c => `${c.method} ${c.path.split("/").slice(-2).join("/")}`)).toEqual([`GET ${M}/invitation`, `POST ${M}/renew`, `GET ${M}/invitation`, `POST ${M}/renew`, "POST renewal/close", "POST renewal/close"]);
    expect(calls.map(c => c.origin)).toEqual([...Array(5).fill(ORIGIN), client.DEFAULT_ORIGIN]);
    expect(calls[1].body).toBe(calls[3].body);
    expect(calls[4].body).toBeNull();
    expect(cli(["renew", "--state", f.state, "--grant-id", G]).status).toBe(1);
    expect(cli(["renewal-close", "--state", f.state, "--bearer-file", a.bearerFile, "--mission-id", M, "--grant-id", G]).status).toBe(1);
    const tokens = readdirSync(join(f.state, "tokens")).map(name => JSON.parse(readFileSync(join(f.state, "tokens", name), "utf8")).token);
    for (const output of [dropped, renewed, closed, unpinned]) {
      for (const secret of [TOKEN, BEARER, ...tokens]) expect(output.stdout + output.stderr).not.toContain(secret);
    }
    const help = run(["--help"], f.parent);
    for (const line of ["renew --state DIR", "--renewable-until ISO", "renewal-close --bearer-file FILE"]) expect(help.stdout).toContain(line);
  });
});

// The API's real gateway and middleware with only the service replaced: the client's renew
// bytes, headers and proof meet the API's own transport rules and strict body schema.
describe.skipIf(process.platform === "win32")("renew through the API mission gateway", () => {
  test("the exact signed renew body passes the gateway and the strict schema, then installs", async () => {
    const f = fixture(), seen: string[] = [];
    let child: any = null;
    const executeMissionRequest = (async (input: any) => {
      const { operation } = missionOperation(input) as { operation: string };
      seen.push(operation);
      if (!verifyMissionProof(input, f.enrollment.public_key, new Date())) throw new MissionError("invalid_credential");
      if (operation === "invitation") return { created: false, data: { mission, grant: f.predecessor } };
      const body = parseMissionInput(missionRenewSchema, await parseMissionBody(input.bodyBytes));
      if (input.proof.grantId !== G || body.mission_digest !== DIGEST) throw new MissionError("invalid_request");
      child = { ...f.predecessor, grant_id: body.grant_id, issued_at: iso(Date.now()), accepted_at: iso(Date.now()), expires_at: iso(Date.now() + 3_600_000),
        renewal: { ...f.predecessor.renewal, renewed_from_grant_id: G } };
      return { created: true, data: { mission, grant: child, token_sha256: body.token_sha256, token_source: "participant" } };
    });
    const gateway = createMissionGateway({ origin: () => ORIGIN, service: { executeMissionRequest } as unknown as MissionGatewayDependencies["service"],
      verify: (async () => ({ ok: false })) as any });
    const app = new Hono();
    app.use("*", collaborationTransportBoundary()); app.use("*", earlyDataReplayProtection()); app.use("*", apiCors());
    app.use("*", (c: any, next: () => Promise<void>) => isCollaborationPath(c.req.path) ? gateway(c) : next());
    const result = await client.renew(f.state, { fetchImpl: async (url: string, init: RequestInit) => app.request(url, init) });
    expect(seen).toEqual(["invitation", "renew"]);
    expect(result).toMatchObject({ renewed: true, grant_id: child.grant_id });
  });
});
