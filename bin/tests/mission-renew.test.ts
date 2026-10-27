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
const missionFor = (d: Record<string, unknown>) => ({ mission_id: M, project_id: PROJECT, descriptor: d, mission_digest: `sha256:${sha(correspondenceCanonicalJson(d))}` });

/** A participant whose imported grant G is accepted, a quarter past its halfway, inside a six-hour window. */
function fixture(grant: Record<string, unknown> = {}, view = mission) {
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
  return { parent, state, enrollment, predecessor, mission: view };
}
type Mode = "ok" | "store-then-drop" | "drop" | "401" | "409" | "403" | "404" | "500" | "400" | "token_hash_conflict";
/** A synthetic service: verifies each request's token and exact-request proof, stores successors, answers probes. */
function service(f: ReturnType<typeof fixture>, renewMode: Mode | Mode[] = "ok", patch: (view: any) => void = () => {}) {
  const hashes = new Map<string, string>([[G, sha(TOKEN)]]), children = new Map<string, any>();
  const calls: Array<{ method: string; path: string; grant: string; body: string | undefined; headers: Headers }> = [];
  const modes = Array.isArray(renewMode) ? [...renewMode] : [renewMode];
  // While readsDown, every GET is a 503 before any check, like a briefly unavailable service;
  // readsAs, when set, builds that GET answer instead (a proxy's HTML or empty 5xx).
  const control: { readsDown: boolean; readsAs: (() => Response) | null } = { readsDown: false, readsAs: null };
  const respond = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
  const fetchImpl = async (url: string, init: RequestInit) => {
    const headers = new Headers(init.headers), path = new URL(url).pathname, grant = headers.get("X-Agenttool-Mission-Grant-Id")!;
    const body = init.body === undefined ? undefined : String(init.body);
    calls.push({ method: String(init.method), path, grant, body, headers });
    if (init.method === "GET" && control.readsDown) return control.readsAs ? control.readsAs() : respond({ error: "mission_unavailable" }, 503);
    const token = headers.get("Authorization")!.slice(7);
    const input = { token, origin: ORIGIN, method: String(init.method), missionId: M, requestTarget: path, bodyBytes: Buffer.from(body ?? ""),
      proof: { grantId: grant, identityId: headers.get("X-Agenttool-Mission-Identity-Id")!, keyId: headers.get("X-Agenttool-Mission-Key-Id")!,
        timestamp: headers.get("X-Agenttool-Mission-Timestamp")!, signature: headers.get("X-Agenttool-Mission-Signature")! } };
    if (hashes.get(grant) !== sha(token) || !verifyMissionProof(input, f.enrollment.public_key, new Date())) return respond({ error: "collaboration_mission_invalid_credential" }, 401);
    if (init.method === "GET") return respond({ mission: f.mission, grant: grant === G ? f.predecessor : children.get(grant) });
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
    // A Machine still on code without the renew route, as during a rolling deploy or a rollback.
    if (mode === "404") return respond({ error: "mission_route_not_found" }, 404);
    if (mode === "400") return respond({ error: "collaboration_mission_invalid_request" }, 400);
    if (mode === "token_hash_conflict") return respond({ error: "token_hash_conflict" }, 409);
    store();
    const { body: _, ...view } = child;
    const result = { mission: structuredClone(f.mission), grant: structuredClone(view), token_sha256: parsed.token_sha256, token_source: "participant" };
    patch(result);
    return respond(result, existing ? 200 : 201);
  };
  return { fetchImpl, calls, children, hashes, control };
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
      note: client.PIN_NOTE });
    expect(client.PIN_NOTE).toContain("chat config");
    expect(client.PIN_NOTE).toContain("work contract");
    expect(client.PIN_NOTE).toContain("wake receiver");
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
    expect(abandoned.next).toContain("a successor of the predecessor that this device did not record, treat this token and key as exposed");
    expect(existsSync(pendingFile(g))).toBe(false);
    expect(JSON.parse(readFileSync(join(g.state, `renewal-abandoned-${pending.grant_id}.json`), "utf8"))).toEqual(pending);
    expect(invitationFile(g).grant_id).toBe(G);
  });

  test("a lapsed invitation with no pending record fails locally: nothing is read, generated or sent", async () => {
    const f = fixture();
    lapse(f);
    let calls = 0;
    await expect(client.renew(f.state, { fetchImpl: async () => { calls++; return new Response("{}"); } })).rejects.toThrow("Invitation expiry is invalid or has passed.");
    expect(calls).toBe(0);
    expect(existsSync(pendingFile(f))).toBe(false);
    expect(existsSync(join(f.state, "tokens"))).toBe(false);
    expect(existsSync(join(f.state, "renewal.lock"))).toBe(false);
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
      ["400", "renewal_refused", true], ["404", "renewal_refused", true], ["500", "renewal_uncertain", false]] as const) {
      const f = fixture(), s = service(f, mode);
      const error = await stop(client.renew(f.state, { fetchImpl: s.fetchImpl }));
      expect(error.stop_reason, mode).toBe(reason);
      expect(existsSync(pendingFile(f)), mode).toBe(!abandoned);
      expect(readdirSync(f.state).some(name => name.startsWith("renewal-abandoned-")), mode).toBe(abandoned);
      expect(invitationFile(f).grant_id).toBe(G);
    }
  });

  test("a resend that reaches code without the renew route keeps the record; the next run installs the stored successor", async () => {
    const f = fixture(), s = service(f, ["store-then-drop", "404", "ok"]);
    await stop(client.renew(f.state, { fetchImpl: s.fetchImpl }));
    const child = JSON.parse(s.calls[1].body!).grant_id;
    const resent = await stop(client.renew(f.state, { fetchImpl: s.fetchImpl }));
    expect(resent).toMatchObject({ stop_reason: "renewal_uncertain", delivered: "unknown", serviceCode: "mission_route_not_found" });
    expect(resent.next).toContain("run renew again to resend the same request");
    expect(existsSync(pendingFile(f))).toBe(true);
    expect(readdirSync(f.state).some(name => name.startsWith("renewal-abandoned-"))).toBe(false);
    const result = await client.renew(f.state, { fetchImpl: s.fetchImpl });
    expect(result).toMatchObject({ renewed: true, grant_id: child, renewed_from_grant_id: G });
    expect(s.calls.map(c => c.method)).toEqual(["GET", "POST", "GET", "POST", "GET", "POST"]);
    expect(new Set(s.calls.filter(c => c.method === "POST").map(c => c.body)).size).toBe(1);
    expect(readdirSync(join(f.state, "tokens"))).toHaveLength(1);
  });

  test("a grant already renewed to an abandoned record of this device recovers through it; to an unknown grant it stops as possible theft", async () => {
    const setup = () => {
      const f = fixture(), s = service(f, "store-then-drop");
      return { f, s, done: stop(client.renew(f.state, { fetchImpl: s.fetchImpl })) };
    };
    // An older run (or client) abandoned a record whose send was in fact stored.
    const { f, s, done } = setup();
    await done;
    const child = JSON.parse(s.calls[1].body!).grant_id, abandonedFile = join(f.state, `renewal-abandoned-${child}.json`);
    writeFileSync(abandonedFile, readFileSync(pendingFile(f)), { mode: 0o600 }); rmSync(pendingFile(f));
    f.predecessor.renewal = { ...f.predecessor.renewal, renewed_to_grant_id: child };
    const recovered = await client.renew(f.state, { fetchImpl: s.fetchImpl });
    expect(recovered).toMatchObject({ renewed: true, grant_id: child, renewed_from_grant_id: G });
    expect(s.calls.slice(2).map(c => `${c.method} ${c.grant === G ? "G" : c.grant === child ? "child" : "other"}`)).toEqual(["GET G", "GET child"]);
    expect(invitationFile(f).grant_id).toBe(child);
    expect(readdirSync(join(f.state, "tokens"))).toHaveLength(1);
    // That successor has since ended: no new renewal is minted.
    const ended = setup();
    await ended.done;
    const gone = JSON.parse(ended.s.calls[1].body!).grant_id;
    writeFileSync(join(ended.f.state, `renewal-abandoned-${gone}.json`), readFileSync(pendingFile(ended.f)), { mode: 0o600 }); rmSync(pendingFile(ended.f));
    ended.f.predecessor.renewal = { ...ended.f.predecessor.renewal, renewed_to_grant_id: gone };
    ended.s.hashes.delete(gone);
    const lost = await stop(client.renew(ended.f.state, { fetchImpl: ended.s.fetchImpl }));
    expect(lost.stop_reason).toBe("renewal_abandoned");
    expect(ended.s.calls.filter(c => c.method === "POST")).toHaveLength(1);
    expect(readdirSync(join(ended.f.state, "tokens"))).toHaveLength(1);
    expect(existsSync(pendingFile(ended.f))).toBe(false);
    // Renewed to a grant this device has no record of: stop before minting anything.
    const g = fixture(), t = service(g), X = "55555555-5555-4555-8555-555555555555";
    g.predecessor.renewal = { ...g.predecessor.renewal, renewed_to_grant_id: X };
    const theft = await stop(client.renew(g.state, { fetchImpl: t.fetchImpl }));
    expect(theft).toMatchObject({ stop_reason: "renewal_conflict", delivered: false });
    expect(theft.next).toContain(`Grant ${G} was already renewed`);
    expect(theft.next).toContain(X);
    expect(t.calls.map(c => c.method)).toEqual(["GET"]);
    expect(existsSync(join(g.state, "tokens"))).toBe(false);
    expect(existsSync(pendingFile(g))).toBe(false);
  });

  test("a 5xx on the invitation read or the recovery probe is uncertain: the record is kept and nothing is abandoned", async () => {
    const abandoned = (f: ReturnType<typeof fixture>) => readdirSync(f.state).some(name => name.startsWith("renewal-abandoned-"));
    // No pending record: nothing was sent, so nothing is delivered.
    const f = fixture(), s = service(f);
    s.control.readsDown = true;
    const fresh = await stop(client.renew(f.state, { fetchImpl: s.fetchImpl }));
    expect(fresh).toMatchObject({ stop_reason: "renewal_uncertain", delivered: false, serviceCode: "mission_unavailable", next: "run renew again" });
    expect(existsSync(pendingFile(f))).toBe(false);
    expect(s.calls.map(c => c.method)).toEqual(["GET"]);
    // A pending record and a live predecessor: the read fails, the record stays.
    const g = fixture(), t = service(g, ["drop", "ok"]);
    await stop(client.renew(g.state, { fetchImpl: t.fetchImpl }));
    t.control.readsDown = true;
    const resumed = await stop(client.renew(g.state, { fetchImpl: t.fetchImpl }));
    expect(resumed).toMatchObject({ stop_reason: "renewal_uncertain", delivered: "unknown", next: "run renew again" });
    expect(existsSync(pendingFile(g))).toBe(true); expect(abandoned(g)).toBe(false);
    t.control.readsDown = false;
    expect(await client.renew(g.state, { fetchImpl: t.fetchImpl })).toMatchObject({ renewed: true, renewed_from_grant_id: G });
    // A lapsed predecessor: the successor-signed probe fails, the record stays.
    const h = fixture(), u = service(h, "store-then-drop");
    await stop(client.renew(h.state, { fetchImpl: u.fetchImpl }));
    lapse(h);
    u.control.readsDown = true;
    const probed = await stop(client.renew(h.state, { fetchImpl: u.fetchImpl }));
    expect(probed).toMatchObject({ stop_reason: "renewal_uncertain", delivered: "unknown", serviceCode: "mission_unavailable", next: "run renew again to resend the same request" });
    expect(existsSync(pendingFile(h))).toBe(true); expect(abandoned(h)).toBe(false);
    expect(invitationFile(h).grant_id).toBe(G);
    u.control.readsDown = false;
    expect(await client.renew(h.state, { fetchImpl: u.fetchImpl })).toMatchObject({ renewed: true, renewed_from_grant_id: G });
  });

  test("a proxy's HTML 502 or bodiless 503 on the invitation read or the probe is uncertain, never a refusal", async () => {
    const abandoned = (f: ReturnType<typeof fixture>) => readdirSync(f.state).some(name => name.startsWith("renewal-abandoned-"));
    for (const [name, answer] of [
      ["html-502", () => new Response("<html><body>502 Bad Gateway</body></html>", { status: 502, headers: { "Content-Type": "text/html" } })],
      ["empty-503", () => new Response(null, { status: 503 })],
    ] as Array<[string, () => Response]>) {
      // A pending record and a live predecessor: the read fails, the record stays.
      const g = fixture(), t = service(g, ["drop", "ok"]);
      await stop(client.renew(g.state, { fetchImpl: t.fetchImpl }));
      t.control.readsDown = true; t.control.readsAs = answer;
      const resumed = await stop(client.renew(g.state, { fetchImpl: t.fetchImpl }));
      expect(resumed, name).toMatchObject({ stop_reason: "renewal_uncertain", delivered: "unknown", serviceCode: null, next: "run renew again" });
      expect(existsSync(pendingFile(g)), name).toBe(true); expect(abandoned(g), name).toBe(false);
      t.control.readsDown = false;
      expect(await client.renew(g.state, { fetchImpl: t.fetchImpl }), name).toMatchObject({ renewed: true, renewed_from_grant_id: G });
      // A lapsed predecessor: the successor-signed probe fails, the record stays.
      const h = fixture(), u = service(h, "store-then-drop");
      await stop(client.renew(h.state, { fetchImpl: u.fetchImpl }));
      lapse(h);
      u.control.readsDown = true; u.control.readsAs = answer;
      const probed = await stop(client.renew(h.state, { fetchImpl: u.fetchImpl }));
      expect(probed, name).toMatchObject({ stop_reason: "renewal_uncertain", delivered: "unknown", serviceCode: null, next: "run renew again to resend the same request" });
      expect(existsSync(pendingFile(h)), name).toBe(true); expect(abandoned(h), name).toBe(false);
      u.control.readsDown = false;
      expect(await client.renew(h.state, { fetchImpl: u.fetchImpl }), name).toMatchObject({ renewed: true, renewed_from_grant_id: G });
      // No pending record: nothing was sent, so nothing is delivered.
      const f = fixture(), s = service(f);
      s.control.readsDown = true; s.control.readsAs = answer;
      expect(await stop(client.renew(f.state, { fetchImpl: s.fetchImpl })), name).toMatchObject({ stop_reason: "renewal_uncertain", delivered: false, next: "run renew again" });
      expect(existsSync(pendingFile(f)), name).toBe(false);
    }
  });

  test("a renew in a state directory with a wake receiver or work contracts says that they pin the previous grant", async () => {
    const f = fixture(), s = service(f), task = "88888888-8888-4888-8888-888888888888";
    mkdirSync(join(f.state, "wake"), { mode: 0o700 });
    writeFileSync(join(f.state, "wake", "binding.json"), "{}", { mode: 0o600 });
    mkdirSync(join(f.state, "work", task), { recursive: true, mode: 0o700 });
    const result = await client.renew(f.state, { fetchImpl: s.fetchImpl });
    expect(result.renewed).toBe(true);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]).toContain("wake/binding.json");
    expect(result.warnings[1]).toContain(`work/${task}`);
    // Without either, the result keeps its established keys.
    const g = fixture(), t = service(g);
    expect(await client.renew(g.state, { fetchImpl: t.fetchImpl })).not.toHaveProperty("warnings");
  });

  test("leave refuses while a renewal is pending and the imported grant has lapsed, naming the successor; it sends nothing", async () => {
    const f = fixture(), s = service(f, "store-then-drop");
    await stop(client.renew(f.state, { fetchImpl: s.fetchImpl }));
    const child = JSON.parse(s.calls[1].body!).grant_id;
    lapse(f);
    const calls = s.calls.length;
    await expect(client.leave(f.state, { fetchImpl: s.fetchImpl })).rejects.toThrow(`A renewal is pending: successor ${child} may be live`);
    expect(s.calls).toHaveLength(calls);
    // After renew resolves the record, leave signs as the installed successor.
    await client.renew(f.state, { fetchImpl: s.fetchImpl });
    let left: { grant: string; path: string } | null = null;
    const result = await client.leave(f.state, { fetchImpl: async (url: string, init: RequestInit) => {
      left = { grant: new Headers(init.headers).get("X-Agenttool-Mission-Grant-Id")!, path: new URL(url).pathname };
      return new Response(JSON.stringify({ mission_id: M, grant_id: child, status: "revoked", reason: "participant_left", revoked_at: iso(Date.now()) }));
    } });
    expect(left).toEqual({ grant: child, path: `/v1/collaboration/missions/${M}/leave` });
    expect(result).toMatchObject({ grant_id: child, recorded: true });
    // With a live predecessor a pending record does not block leave: the service ends the whole chain.
    const g = fixture(), t = service(g, "store-then-drop");
    await stop(client.renew(g.state, { fetchImpl: t.fetchImpl }));
    const live = await client.leave(g.state, { fetchImpl: async () =>
      new Response(JSON.stringify({ mission_id: M, grant_id: G, status: "revoked", reason: "participant_left", revoked_at: iso(Date.now()) })) });
    expect(live).toMatchObject({ grant_id: G, recorded: true });
  });

  test("leave and renew exclude each other through renewal.lock; leave signs with the one invitation it read", async () => {
    const f = fixture(), s = service(f), posted = Promise.withResolvers<void>(), gate = Promise.withResolvers<void>();
    // A renew run that has stored its successor but not yet installed it.
    const running = client.renew(f.state, { fetchImpl: async (url: string, init: RequestInit) => {
      if (init.method === "POST") { const response = await s.fetchImpl(url, init); posted.resolve(); await gate.promise; return response; }
      return s.fetchImpl(url, init);
    } });
    await posted.promise;
    const calls = s.calls.length;
    let leaveCalls = 0;
    await expect(client.leave(f.state, { fetchImpl: async () => { leaveCalls++; return new Response("{}"); } }))
      .rejects.toThrow("Another renew run holds renewal.lock; nothing was sent.");
    expect(leaveCalls).toBe(0);
    gate.resolve();
    const renewed = await running;
    expect(s.calls).toHaveLength(calls);
    // Once the renew run is done, leave signs as the installed successor and holds the lock itself.
    let seen: { grant: string; lock: boolean } | null = null;
    const left = await client.leave(f.state, { fetchImpl: async (_url: string, init: RequestInit) => {
      seen = { grant: new Headers(init.headers).get("X-Agenttool-Mission-Grant-Id")!, lock: existsSync(join(f.state, "renewal.lock")) };
      return new Response(JSON.stringify({ mission_id: M, grant_id: renewed.grant_id, status: "revoked", reason: "participant_left", revoked_at: iso(Date.now()) }));
    } });
    expect(seen).toEqual({ grant: renewed.grant_id, lock: true });
    expect(left).toMatchObject({ grant_id: renewed.grant_id, recorded: true });
    expect(existsSync(join(f.state, "renewal.lock"))).toBe(false);
    // A renew started while leave is in flight stops before sending.
    const g = fixture(), t = service(g), inFlight = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    const leaving = client.leave(g.state, { fetchImpl: async () => { inFlight.resolve(); await release.promise;
      return new Response(JSON.stringify({ mission_id: M, grant_id: G, status: "revoked", reason: "participant_left", revoked_at: iso(Date.now()) })); } });
    await inFlight.promise;
    expect((await stop(client.renew(g.state, { fetchImpl: t.fetchImpl }))).stop_reason).toBe("renewal_in_progress");
    expect(t.calls).toHaveLength(0);
    release.resolve();
    expect(await leaving).toMatchObject({ grant_id: G, recorded: true });
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
      ["other-identity", (v: any) => { v.grant.identity_id = "55555555-5555-4555-8555-555555555555"; }],
      ["other-grant-mission", (v: any) => { v.grant.mission_id = "55555555-5555-4555-8555-555555555555"; }],
      ["other-mission", (v: any) => { v.mission.mission_id = "55555555-5555-4555-8555-555555555555"; }],
      ["other-origin", (v: any) => { v.grant.origin = "https://other.invalid"; }],
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

  test("a descriptor string \"token\" is data, not a token key: the successor installs and its recovery read too", async () => {
    const view = missionFor({ ...descriptor, resources: [{ format: "token" }], acceptance_criteria: ["token"] });
    const f = fixture({}, view), s = service(f);
    expect(await client.renew(f.state, { fetchImpl: s.fetchImpl })).toMatchObject({ renewed: true, renewed_from_grant_id: G });
    expect(existsSync(pendingFile(f))).toBe(false);
    const g = fixture({}, view), lost = service(g, "store-then-drop");
    await stop(client.renew(g.state, { fetchImpl: lost.fetchImpl }));
    lapse(g);
    expect(await client.renew(g.state, { fetchImpl: lost.fetchImpl })).toMatchObject({ renewed: true, renewed_from_grant_id: G });
    // A token key anywhere in the view is still refused.
    for (const patch of [(v: any) => { v.mission.token = TOKEN; }, (v: any) => { v.grant.renewal.token = TOKEN; }]) {
      const h = fixture({}, view), bad = service(h, "ok", patch);
      expect((await stop(client.renew(h.state, { fetchImpl: bad.fetchImpl }))).stop_reason).toBe("renewal_response_invalid");
    }
  });

  test("a 401 for the still-unexpired predecessor recovers a stored successor, from the read or from the send", async () => {
    // The invitation read is refused: the server ended or expired G while the local clock still holds it.
    const f = fixture(), s = service(f, "store-then-drop");
    await stop(client.renew(f.state, { fetchImpl: s.fetchImpl }));
    const child = JSON.parse(s.calls[1].body!).grant_id;
    s.hashes.delete(G);
    expect(await client.renew(f.state, { fetchImpl: s.fetchImpl })).toMatchObject({ renewed: true, grant_id: child, renewed_from_grant_id: G });
    expect(s.calls.slice(2).map(c => `${c.method} ${c.path.split("/").at(-1)} as ${c.grant === G ? "G" : c.grant === child ? "child" : "other"}`))
      .toEqual(["GET invitation as G", "GET invitation as child"]);
    expect(invitationFile(f).grant_id).toBe(child);
    expect(existsSync(pendingFile(f))).toBe(false);
    // The resend is refused with 401.
    const g = fixture(), t = service(g, ["store-then-drop", "401"]);
    await stop(client.renew(g.state, { fetchImpl: t.fetchImpl }));
    const second = JSON.parse(t.calls[1].body!).grant_id;
    expect(await client.renew(g.state, { fetchImpl: t.fetchImpl })).toMatchObject({ renewed: true, grant_id: second });
    expect(t.calls.slice(2).map(c => `${c.method} ${c.path.split("/").at(-1)} as ${c.grant === G ? "G" : "child"}`))
      .toEqual(["GET invitation as G", "POST renew as G", "GET invitation as child"]);
    expect(invitationFile(g).grant_id).toBe(second);
  });

  test("a 401 for the predecessor with no stored successor abandons the record, from the read or from the send", async () => {
    for (const via of ["read", "send"] as const) {
      const f = fixture(), s = service(f, ["drop", "401"]);
      await stop(client.renew(f.state, { fetchImpl: s.fetchImpl }));
      const pending = JSON.parse(readFileSync(pendingFile(f), "utf8"));
      if (via === "read") s.hashes.delete(G);
      const abandoned = await stop(client.renew(f.state, { fetchImpl: s.fetchImpl }));
      expect(abandoned.stop_reason, via).toBe("renewal_abandoned");
      expect(s.calls.at(-1), via).toMatchObject({ method: "GET", grant: pending.grant_id });
      expect(existsSync(pendingFile(f)), via).toBe(false);
      expect(JSON.parse(readFileSync(join(f.state, `renewal-abandoned-${pending.grant_id}.json`), "utf8")), via).toEqual(pending);
      expect(invitationFile(f).grant_id, via).toBe(G);
    }
  });

  test("concurrent resumes are exclusive: one installs, the other stops before sending, and one backup remains", async () => {
    const f = fixture(), s = service(f, ["store-then-drop", "ok"]);
    await stop(client.renew(f.state, { fetchImpl: s.fetchImpl }));
    const child = JSON.parse(s.calls[1].body!).grant_id, sent = s.calls.length;
    const [first, second] = await Promise.allSettled([client.renew(f.state, { fetchImpl: s.fetchImpl }), client.renew(f.state, { fetchImpl: s.fetchImpl })]);
    expect(first).toMatchObject({ status: "fulfilled", value: { renewed: true, grant_id: child } });
    expect(second.status).toBe("rejected");
    const busy = (second as PromiseRejectedResult).reason;
    expect(busy).toBeInstanceOf(client.RenewalError);
    expect(busy).toMatchObject({ stop_reason: "renewal_in_progress", delivered: false });
    expect(s.calls.length - sent).toBe(2);
    expect(readdirSync(f.state).filter(name => name.startsWith("invitation.replaced-"))).toHaveLength(1);
    expect(existsSync(join(f.state, "renewal.lock"))).toBe(false);
    expect(invitationFile(f).grant_id).toBe(child);
    // A lock left by a crashed run stops renew without any request until it is inspected and removed.
    writeFileSync(join(f.state, "renewal.lock"), "{}", { mode: 0o600 });
    const calls = s.calls.length;
    expect((await stop(client.renew(f.state, { fetchImpl: s.fetchImpl }))).stop_reason).toBe("renewal_in_progress");
    expect(s.calls).toHaveLength(calls);
  });

  test("the renewal is signed as the grant the pending record names, even if invitation.json changes mid-run", async () => {
    const f = fixture(), s = service(f);
    const X = "55555555-5555-4555-8555-555555555555", other = { ...invitationFile(f), grant_id: X, token: `atcm_${Buffer.alloc(32, 29).toString("base64url")}` };
    let swapped = false;
    const fetchImpl = async (url: string, init: RequestInit) => {
      const response = await s.fetchImpl(url, init);
      // Another process imports a different invitation right after the read.
      if (!swapped) { swapped = true; writeFileSync(join(f.state, "invitation.json"), JSON.stringify(other), { mode: 0o600 }); }
      return response;
    };
    const error = await stop(client.renew(f.state, { fetchImpl }));
    expect(s.calls.map(c => `${c.method} ${c.grant === G ? "G" : c.grant}`)).toEqual(["GET G", "POST G"]);
    expect(error.stop_reason).toBe("renewal_pending_mismatch");
    expect(error.message).toContain("invitation.json changed");
    // Nothing overwrote the other invitation; the record stays for inspection.
    expect(invitationFile(f).grant_id).toBe(X);
    expect(existsSync(pendingFile(f))).toBe(true);
    expect(readdirSync(f.state).some(name => name.startsWith("invitation.replaced-"))).toBe(false);
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
      [until, () => ({ ...window, closed_at: iso(Date.now()) })], [until, () => ({ ...window, renewed_from_grant_id: K })],
      [until, () => ({ ...window, root_grant_id: K })], [undefined, () => window]] as const) {
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
    for (const body of [{ grant: { grant_id: G, mission_id: M, token: TOKEN } }, { grant: { grant_id: G, mission_id: M }, token: TOKEN }]) {
      await expect(client.closeRenewal({ bearerFile: a.bearerFile, missionId: M, grantId: G, serviceOrigin: ORIGIN }, { fetchImpl: async () => new Response(JSON.stringify(body)) }))
        .rejects.toThrow("does not confirm the window close");
    }
    // A renewal object that does not carry a canonical closed_at does not confirm the close.
    for (const closed_at of [null, "2026-10-27T12:00:00Z", undefined]) {
      const renewal = { root_grant_id: G, renewed_from_grant_id: null, renewed_to_grant_id: null, renewable_until: iso(Date.now() + 3_600_000), ...(closed_at === undefined ? {} : { closed_at }) };
      await expect(client.closeRenewal({ bearerFile: a.bearerFile, missionId: M, grantId: G, serviceOrigin: ORIGIN }, { fetchImpl: async () =>
        new Response(JSON.stringify({ grant: { grant_id: G, mission_id: M, renewal } })) })).rejects.toThrow("does not confirm the window close");
    }
    // A string value "token" is data, not a token key.
    expect(await client.closeRenewal({ bearerFile: a.bearerFile, missionId: M, grantId: G, serviceOrigin: ORIGIN }, { fetchImpl: async () =>
      new Response(JSON.stringify({ grant: { grant_id: G, mission_id: M, revocation_reason: "token" } })) })).toMatchObject({ grant_id: G, renewable: false });
  });

  test("the CLI prints one structured stop on stderr, never a token or bearer, and renew succeeds offline", () => {
    const f = fixture(), a = admin(f), marker = join(f.parent, "calls.jsonl"), preload = join(f.parent, "synthetic-service.mjs");
    writeFileSync(preload, `import { appendFileSync } from 'node:fs';
const predecessor = ${JSON.stringify(f.predecessor)}, mission = ${JSON.stringify(mission)};
globalThis.fetch = async (url, init) => {
  const path = new URL(url).pathname;
  appendFileSync(${JSON.stringify(marker)}, JSON.stringify({ origin: new URL(url).origin, path, method: init.method, body: init.body ?? null }) + '\\n');
  if (process.env.MISSION_FIXTURE_MODE === 'drop' && init.method === 'POST') throw new Error('socket closed ' + init.headers.Authorization);
  if (path.endsWith('/renewal/close') && process.env.MISSION_FIXTURE_MODE === 'still-open') return new Response(JSON.stringify({ grant: { grant_id: ${JSON.stringify(G)}, mission_id: ${JSON.stringify(M)},
    renewal: { ...predecessor.renewal, closed_at: null } } }));
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
    // An answer whose window is still open is never printed as a close.
    const stillOpen = cli(["renewal-close", "--bearer-file", a.bearerFile, "--mission-id", M, "--grant-id", G, "--origin", ORIGIN], "still-open");
    expect(stillOpen.status).toBe(1); expect(stillOpen.stdout).toBe("");
    expect(stillOpen.stderr).toContain("does not confirm the window close"); expect(stillOpen.stderr).not.toContain(BEARER);
    expect(cli(["renew", "--state", f.state, "--grant-id", G]).status).toBe(1);
    expect(cli(["renewal-close", "--state", f.state, "--bearer-file", a.bearerFile, "--mission-id", M, "--grant-id", G]).status).toBe(1);
    const tokens = readdirSync(join(f.state, "tokens")).map(name => JSON.parse(readFileSync(join(f.state, "tokens", name), "utf8")).token);
    for (const output of [dropped, renewed, closed, unpinned]) {
      for (const secret of [TOKEN, BEARER, ...tokens]) expect(output.stdout + output.stderr).not.toContain(secret);
    }
    const help = run(["--help"], f.parent);
    for (const line of ["renew --state DIR", "--renewable-until ISO", "renewal-close --bearer-file FILE", "chain, every member including the current one"]) expect(help.stdout).toContain(line);
    expect(help.stdout).not.toContain("Revoke only this participant's own grant");
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
