/** The lobby desk's fleet hall against the API's own mission gateway and
 * enrollment router, in process. Only persistence is replaced: an in-memory
 * service built from the API's own contract helpers (operation routing,
 * strict bodies, exact-request proof verification, digests, event paging) and
 * the API's own enrollment signing bytes. Synthetic project, bearer and keys;
 * no live service, no real Keychain, scripted terminals. */
import { afterEach, describe, expect, test } from "bun:test";
import { createPublicKey, verify } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "../../api/node_modules/hono/dist/index.js";
import { createMissionGateway, type MissionGatewayDependencies } from "../../api/src/routes/collaboration";
import { createIdentityEnrollmentRouter } from "../../api/src/routes/identity/enroll";
import { collaborationTransportBoundary, isCollaborationPath } from "../../api/src/middleware/collaboration-boundary";
import { earlyDataReplayProtection } from "../../api/src/middleware/early-data";
import { apiCors } from "../../api/src/middleware/api-cors";
import {
  createMissionSchema, issueMissionGrantSchema, MISSION_BOUNDS, missionAcceptSchema, MissionError, missionObservationSchema,
  missionOperation, packMissionEventPage, parseMissionBody, parseMissionInput,
} from "../../api/src/services/collaboration/contracts";
import { canonicalMissionRequestBytes, MISSION_REQUEST_DOMAIN, missionSha256, verifyMissionProof } from "../../api/src/services/collaboration/proof";
import { correspondenceCanonicalJson } from "../../api/src/services/correspondence/canonical";
import { canonicalIdentityEnrollmentBytes, identityEnrollmentSchema } from "../../api/src/services/identity/enrollment";
import { runCli } from "../../packages/lobby/src/cli";
import { FileSecretStore } from "../../packages/lobby/src/keychain";
import { confirmOnTty, type TtyPort } from "../../packages/lobby/src/tty";
import {
  enrollmentDigest, generateKeyPair, LOBBY_ORIGIN, missionDigest, publicKeyBase64, requestDigest, signBytes, validateMissionDescriptor,
} from "../../packages/lobby/src/wire";

const ORIGIN = "https://api.agenttool.dev";
const PROJECT = "66666666-6666-4666-8666-666666666666";
const API_KEY = "77777777-7777-4777-8777-777777777777";
// Clearly synthetic administrator bearer: it never reaches a real service.
const BEARER = "at_syntheticLobbyGatewayFixture0";
const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

/** In-memory persistence behind the real gateway, using the API's own rules. */
function memoryService(now: () => Date) {
  const identities = new Map<string, { keyId: string; publicKey: string }>();
  const missions = new Map<string, { row: any; events: any[] }>();
  const grants = new Map<string, any>();
  const operations: string[] = [];
  const missionView = (row: any) => ({
    mission_id: row.id, project_id: PROJECT, descriptor: row.descriptor, mission_digest: row.digest, created_at: row.createdAt,
    expires_at: row.expiresAt, revoked_at: null, scope: "mission_selected_context", authority: "descriptive_context_only",
  });
  const grantView = (grant: any) => ({
    grant_id: grant.id, mission_id: grant.missionId, project_id: PROJECT, identity_id: grant.identityId, signing_key_id: grant.signingKeyId,
    issuing_api_key_id: API_KEY, origin: ORIGIN, actions: grant.actions, issued_at: grant.issuedAt, expires_at: grant.expiresAt,
    accepted_at: grant.acceptedAt, revoked_at: null,
  });
  const service: Partial<MissionGatewayDependencies["service"]> = {
    createMission: (async (input: any) => {
      const parsed = parseMissionInput(createMissionSchema, { mission_id: input.missionId, descriptor: input.descriptor, expires_at: input.expiresAt });
      const expires = Date.parse(parsed.expires_at);
      if (expires <= now().getTime() || expires - now().getTime() > MISSION_BOUNDS.missionAgeMs) throw new MissionError("invalid_request");
      if (missions.has(parsed.mission_id)) throw new MissionError("conflict");
      const row = { id: parsed.mission_id, descriptor: parsed.descriptor, digest: `sha256:${missionSha256(correspondenceCanonicalJson(parsed.descriptor))}`,
        createdAt: now().toISOString(), expiresAt: parsed.expires_at };
      missions.set(row.id, { row, events: [] });
      operations.push("create_mission");
      return missionView(row);
    }) as any,
    getMission: (async (input: any) => {
      const mission = missions.get(input.missionId);
      if (!mission) throw new MissionError("not_found");
      return missionView(mission.row);
    }) as any,
    issueMissionGrant: (async (input: any) => {
      const parsed = parseMissionInput(issueMissionGrantSchema, { grant_id: input.grantId, identity_id: input.identityId,
        signing_key_id: input.signingKeyId, actions: input.actions, expires_at: input.expiresAt, token_sha256: input.tokenSha256 });
      const identity = identities.get(parsed.identity_id);
      const mission = missions.get(input.missionId);
      const expires = Date.parse(parsed.expires_at);
      if (!identity || identity.keyId !== parsed.signing_key_id || !mission || expires <= now().getTime()
        || expires - now().getTime() > MISSION_BOUNDS.grantAgeMs || expires > Date.parse(mission.row.expiresAt)) throw new MissionError("invalid_credential");
      if (parsed.token_sha256 === undefined) throw new Error("the desk must always send a participant token hash");
      if (grants.has(parsed.grant_id)) throw new MissionError("conflict");
      if ([...grants.values()].some(grant => grant.tokenHash === parsed.token_sha256)) throw new MissionError("token_hash_conflict");
      const grant = { id: parsed.grant_id, missionId: input.missionId, identityId: parsed.identity_id, signingKeyId: parsed.signing_key_id,
        actions: [...parsed.actions].sort(), issuedAt: now().toISOString(), expiresAt: parsed.expires_at, acceptedAt: null as string | null,
        tokenHash: parsed.token_sha256 };
      grants.set(grant.id, grant);
      operations.push("issue_grant");
      return { grant: grantView(grant), token_sha256: grant.tokenHash, token_source: "participant" };
    }) as any,
    getMissionGrant: (async (input: any) => {
      const grant = grants.get(input.grantId);
      if (!grant) throw new MissionError("not_found");
      return grantView(grant);
    }) as any,
    executeMissionRequest: (async (input: any) => {
      const selected = missionOperation(input);
      const deny = () => new MissionError("invalid_credential");
      const grant = [...grants.values()].find(candidate => candidate.tokenHash === missionSha256(input.token));
      if (!grant || grant.id !== input.proof.grantId || grant.missionId !== input.missionId || grant.identityId !== input.proof.identityId
        || grant.signingKeyId !== input.proof.keyId || Date.parse(grant.expiresAt) <= now().getTime()) throw deny();
      // The API's own exact-request proof verification against the enrolled key.
      if (!verifyMissionProof(input, identities.get(grant.identityId)!.publicKey, now())) throw deny();
      const mission = missions.get(grant.missionId)!;
      operations.push(selected.operation);
      if (selected.operation === "invitation") return { created: false, data: { mission: missionView(mission.row), grant: grantView(grant) } };
      if (selected.operation === "accept") {
        const body = parseMissionInput(missionAcceptSchema, await parseMissionBody(input.bodyBytes));
        if (body.mission_digest !== mission.row.digest) throw new MissionError("conflict");
        grant.acceptedAt ??= now().toISOString();
        return { created: true, data: { mission: missionView(mission.row), grant: grantView(grant) } };
      }
      const action = selected.operation === "observe" ? "mission.observe" : "mission.read";
      if (!grant.actions.includes(action)) throw deny();
      if (!grant.acceptedAt) throw new MissionError("acceptance_required");
      if (selected.operation === "list") {
        const candidates = mission.events.filter(event => BigInt(event.received_seq) > selected.after);
        return { created: false, data: packMissionEventPage(mission.row.id, selected.after.toString(),
          candidates.slice(0, selected.limit), candidates.length > selected.limit) };
      }
      const observation = parseMissionInput(missionObservationSchema, await parseMissionBody(input.bodyBytes));
      const rawBody = new TextDecoder("utf-8", { fatal: true }).decode(input.bodyBytes);
      const existing = mission.events.find(event => event.event_id === observation.event_id);
      if (existing) {
        if (existing.raw_body !== rawBody) throw new MissionError("conflict");
        return { created: false, data: { event: existing } };
      }
      const event = { event_id: observation.event_id, mission_id: mission.row.id, grant_id: grant.id, identity_id: grant.identityId,
        signing_key_id: grant.signingKeyId, received_seq: String(mission.events.length + 1), received_at: now().toISOString(),
        observation, raw_body: rawBody, body_sha256: missionSha256(input.bodyBytes),
        proof: { domain: MISSION_REQUEST_DOMAIN, origin: input.origin, method: input.method, request_target: input.requestTarget,
          timestamp: input.proof.timestamp, signature: input.proof.signature, public_key: identities.get(grant.identityId)!.publicKey,
          raw_body: rawBody, body_sha256: missionSha256(input.bodyBytes) } };
      mission.events.push(event);
      return { created: true, data: { event } };
    }) as any,
  };
  /** The enrollment router's injected service: the API's schema and signing bytes. */
  const enroll = async (input: { projectId: string; origin: string; bodyBytes: Uint8Array; signature: string }) => {
    const body = identityEnrollmentSchema.parse(JSON.parse(Buffer.from(input.bodyBytes).toString("utf8")));
    if (body.project_id !== input.projectId || body.origin !== input.origin) throw new Error("enrollment bound to another project or origin");
    if (Math.abs(now().getTime() - Date.parse(body.timestamp)) > 300_000) throw new Error("enrollment outside its window");
    const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(body.public_key, "base64").toString("base64url") }, format: "jwk" });
    if (!verify(null, canonicalIdentityEnrollmentBytes(input), key, Buffer.from(input.signature, "base64url"))) throw new Error("enrollment signature invalid");
    identities.set(body.identity_id, { keyId: body.signing_key_id, publicKey: body.public_key });
    operations.push("enroll");
    return {
      identity: { id: body.identity_id, did: `did:at:${body.identity_id}`, display_name: body.display_name, capabilities: body.capabilities, status: "active" as const },
      key: { kid: body.signing_key_id, public_key: body.public_key },
      authority: { mode: "agent_root" as const, root_public_key: body.public_key, sequence: 0, next_sequence: 1 },
    };
  };
  return { service, enroll, missions, grants, identities, operations };
}

function apiApp(memory: ReturnType<typeof memoryService>) {
  const gateway = createMissionGateway({ origin: () => ORIGIN, service: memory.service as MissionGatewayDependencies["service"],
    verify: (async (token: string) => token === BEARER ? { ok: true, project: { id: PROJECT }, apiKey: { id: API_KEY } } : { ok: false }) as any });
  const enrollment = createIdentityEnrollmentRouter({ origin: () => ORIGIN, enroll: memory.enroll as any });
  const app = new Hono();
  app.use("*", collaborationTransportBoundary());
  app.use("*", earlyDataReplayProtection());
  app.use("*", apiCors());
  app.use("*", (c: any, next: () => Promise<void>) => isCollaborationPath(c.req.path) ? gateway(c) : next());
  // A stand-in for the project auth middleware in front of the real enrollment router.
  app.use("/v1/identities/enroll", async (c: any, next: () => Promise<void>) => {
    if (c.req.header("Authorization") !== `Bearer ${BEARER}`) return c.json({ error: "unauthorized" }, 401);
    c.set("project", { id: PROJECT });
    c.set("apiKeyId", API_KEY);
    await next();
  });
  app.route("/v1/identities/enroll", enrollment as any);
  app.all("*", (c: any) => c.json({ error: "outside_fixture" }, 404));
  return async (url: string, init: RequestInit) => app.request(url, init);
}

function desk(fetchImpl: (url: string, init: RequestInit) => Promise<Response>, now: () => Date) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), "lobby-gateway-")));
  cleanups.push(() => rmSync(parent, { recursive: true, force: true }));
  const keychain = new FileSecretStore(join(parent, "keychain"));
  const answers: string[] = [];
  const openTty = (): TtyPort => ({ write: () => {}, readLine: () => answers.shift() ?? null, close: () => {} });
  const run = async (...argv: string[]) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runCli(argv, {
      stdout: text => out.push(text), stderr: text => err.push(text), env: { AGENTTOOL_LOBBY_HOME: join(parent, "lobby") },
      confirm: request => confirmOnTty(request, { openTty }), showOnTty: () => {}, now, fetchImpl, keychain, deviceTerms: [],
    });
    if (code !== 0) throw new Error(`agenttool-lobby ${argv.join(" ")} exited ${code}: ${err.join("")}`);
    return out.join("");
  };
  return {
    keychain,
    run,
    yes: (...argv: string[]) => { answers.push("yes"); return run(...argv); },
    file: (name: string, text: string) => { const path = join(parent, name); writeFileSync(path, text, { mode: 0o600 }); return path; },
  };
}

describe("lobby fleet hall through the API's mission gateway and enrollment router", () => {
  test("the desk's request and enrollment digests are the API's signing bytes", () => {
    const input = { origin: ORIGIN, method: "POST", requestTarget: "/v1/collaboration/missions/11111111-1111-4111-8111-111111111111/events",
      missionId: "11111111-1111-4111-8111-111111111111", bodyBytes: Buffer.from('{"event_id":"x","summary":"雨夜"}'),
      proof: { grantId: "22222222-2222-4222-8222-222222222222", identityId: "33333333-3333-4333-8333-333333333333",
        keyId: "44444444-4444-4444-8444-444444444444", timestamp: "2026-10-16T12:00:00.000Z", signature: "" } };
    const ours = requestDigest({ origin: input.origin, method: "POST", target: input.requestTarget, missionId: input.missionId,
      grantId: input.proof.grantId, identityId: input.proof.identityId, keyId: input.proof.keyId, body: input.bodyBytes, timestamp: input.proof.timestamp });
    expect(Buffer.from(ours)).toEqual(Buffer.from(canonicalMissionRequestBytes(input)));
    const key = generateKeyPair();
    const signature = signBytes(key, ours).toString("base64url");
    expect(verifyMissionProof({ ...input, token: "", proof: { ...input.proof, signature } } as any, publicKeyBase64(key), new Date("2026-10-16T12:01:00.000Z"))).toBe(true);
    const enrollment = { origin: ORIGIN, projectId: PROJECT, bodyBytes: Buffer.from("{}") };
    expect(Buffer.from(enrollmentDigest(enrollment))).toEqual(Buffer.from(canonicalIdentityEnrollmentBytes(enrollment)));
    const descriptor = { format: "agenttool-collaboration-mission/v1" as const, purpose: "大廳 🌞", resources: [], acceptance_criteria: ["c"], principalities: [] };
    expect(missionDigest(validateMissionDescriptor(descriptor))).toBe(`sha256:${missionSha256(correspondenceCanonicalJson(descriptor))}`);
    expect(LOBBY_ORIGIN).toBe(ORIGIN);
  });

  test("hub init, enroll-device, relay, join, season, publish, knock, admit and ready pass the real gateway", async () => {
    let clock = Date.parse("2026-10-16T12:00:00.000Z");
    const now = () => new Date(clock);
    const memory = memoryService(now);
    const fetchImpl = apiApp(memory);
    const hub = desk(fetchImpl, now);
    const device = desk(fetchImpl, now);
    await hub.keychain.add({ service: "agenttool-lobby.hub-bearer", account: "agenttool-lobby" }, BEARER);

    const init = await hub.yes("hub", "init", "--project", PROJECT);
    const door = /door fingerprint ([0-9a-f]{16})/.exec(init)![1]!;
    for (const who of [hub, device]) {
      const packet = await who.run("enroll-device", "--project", PROJECT);
      const join = await hub.yes("hub", "relay", "--packet-file", who.file("packet.json", packet));
      await who.yes("fleet", "join", "--packet-file", who.file("join.json", join), "--door-fingerprint", door);
    }
    const roomId = JSON.parse(await hub.run("room", "add", "--title", "Zerone season 1", "--door", "knock", "--tag", "zerone", "--json")).card.room_id;
    await hub.yes("room", "promote", roomId, "--residency", "fleet", "--hostable", "true");
    const season = await hub.yes("hub", "season", "open", roomId);
    const [, seasonId, seasonDigest] = /season ([0-9a-f-]{36}) digest (sha256:[0-9a-f]{64})/.exec(season)!;
    await hub.yes("room", "publish", roomId);

    clock += 60_000;
    await device.run("fleet", "sync");
    const browsed = JSON.parse(await device.run("fleet", "browse", "--json"));
    expect(browsed.rooms.map((room: any) => [room.fields.room_id.value, room.signed_by.door_fingerprint])).toEqual([[roomId, door]]);
    const knocked = await device.yes("knock", roomId, "--tier", "player", "--note", "hello from the second desk");
    const knockId = /knock ([0-9a-f-]{36})/.exec(knocked)![1]!;
    clock += 60_000;
    const knocks = JSON.parse(await hub.run("hub", "knocks", "--json")).knocks;
    expect(knocks).toEqual([expect.objectContaining({ knock_id: knockId, status: "pending" })]);
    await hub.yes("hub", "admit", knockId);
    clock += 60_000;
    const ready = await device.yes("ready", knockId);
    expect(ready).toContain(`accepted season ${seasonId} digest ${seasonDigest}`);

    // Every participant request passed the API's verifyMissionProof; the grant was bound to the device's own hash.
    expect(memory.operations.filter(operation => operation === "enroll")).toHaveLength(2);
    const seasonGrants = [...memory.grants.values()].filter(grant => grant.missionId === seasonId);
    expect(seasonGrants.every(grant => grant.acceptedAt !== null)).toBe(true);
    expect(memory.missions.get(seasonId!)!.events.map((event: any) => JSON.parse(event.observation.summary).kind)).toEqual(["admission", "roster"]);
  });
});
