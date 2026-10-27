/** Real migration/service races, only against an explicitly selected empty loopback fixture DB.
 * Doctrine: docs/COLLABORATION-MISSIONS.md. Never falls back to application DATABASE_URL.
 */
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import * as ed from "@noble/ed25519";
import { drizzle } from "drizzle-orm/postgres-js";
import type { Sql } from "postgres";
import postgres from "../fixtures/verified-postgres";
import { closeMissionGrantRenewal, createMission, executeMissionRequest, getMission, getMissionGrant, issueMissionGrant, revokeMission, revokeMissionGrant, type ServerIssuedMissionGrant } from "../../src/services/collaboration/store";
import { correspondenceCanonicalJson } from "../../src/services/correspondence/canonical";
import { canonicalMissionRequestBytes, verifyMissionProof } from "../../src/services/collaboration/proof";
import type { MissionAction, MissionRequest } from "../../src/services/collaboration/contracts";

const DATABASE = process.env.COLLABORATION_MISSION_TEST_DATABASE_URL?.trim() ?? "";
const databaseTest = DATABASE ? test : test.skip;
const uid = (n: number) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
const P = uid(1), O = uid(2), I = uid(3), J = uid(4), K = uid(5), L = uid(6), A = uid(7), B = uid(8), M = uid(9), G = uid(10), H = uid(11), E = uid(12);
const NOW = new Date("2026-09-28T09:00:00.000Z"), END = new Date(NOW.getTime() + 3_600_000);
const ORIGIN = "https://api.agenttool.dev", BASE = `/v1/collaboration/missions/${M}`;
const PRIVATE = new Uint8Array(32).fill(7), OTHER_PRIVATE = new Uint8Array(32).fill(8);
const PUBLIC = Buffer.from(ed.getPublicKey(PRIVATE)).toString("base64"), OTHER_PUBLIC = Buffer.from(ed.getPublicKey(OTHER_PRIVATE)).toString("base64");
const descriptor = { format: "agenttool-collaboration-mission/v1", purpose: "Selected collaboration", resources: [], acceptance_criteria: ["Report evidence"], principalities: [] };
let admin: Sql, service: Sql, locker: Sql, database: ReturnType<typeof drizzle>, owned = false;
let legacyRows: Array<Record<string, unknown>> = [];
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const DIGEST = `sha256:${sha(correspondenceCanonicalJson(descriptor))}`;
const LEGACY_TOKEN = `atcm_${Buffer.alloc(32, 21).toString("base64url")}`;
// Exactly the column list the a99257ab code inserts: no renewal columns.
const legacyGrantInsert = `INSERT INTO tools.collaboration_grants (id, project_id, mission_id, identity_id, signing_key_id, issuing_api_key_id,
  token_hash, origin, actions, issued_at, expires_at, accepted_at, acceptance_proof, revoked_at) VALUES ('${G}', '${P}', '${M}', '${I}', '${K}', '${A}',
  '${sha(LEGACY_TOKEN)}', '${ORIGIN}', ARRAY['mission.observe','mission.read'], '${NOW.toISOString()}', '${END.toISOString()}', NULL, NULL, NULL);`;
const LEGACY_MISSION = `INSERT INTO tools.collaboration_missions (id, project_id, creator_api_key_id, descriptor, digest, created_at, expires_at)
  VALUES ('${M}', '${P}', '${A}', '${JSON.stringify(descriptor)}'::jsonb, '${DIGEST}', '${NOW.toISOString()}', '${new Date(NOW.getTime() + 86_400_000).toISOString()}');`;
const LEGACY_SEED = `INSERT INTO tools.projects (id) VALUES ('${P}'); INSERT INTO tools.api_keys (id, project_id) VALUES ('${A}', '${P}');
  INSERT INTO identity.identities (id, project_id, status) VALUES ('${I}', '${P}', 'active');
  INSERT INTO identity.identity_keys (id, identity_id, public_key, active) VALUES ('${K}', '${I}', '${PUBLIC}', true);
  ${LEGACY_MISSION} ${legacyGrantInsert}`;
const options = () => ({ database, now: NOW });
const target = { projectId: P, missionId: M };
const grantInput = (actions: MissionAction[] = ["mission.read", "mission.observe"]) => ({ ...target, issuerApiKeyId: A, grantId: G, identityId: I, signingKeyId: K, origin: ORIGIN, actions, expiresAt: END.toISOString() });
function req(token: string, path: string, body?: unknown, overrides: Partial<MissionRequest> = {}, privateKey = PRIVATE): MissionRequest {
  const request: MissionRequest = { token, missionId: M, origin: ORIGIN, method: body === undefined ? "GET" : "POST",
    requestTarget: BASE + path, bodyBytes: body === undefined ? new Uint8Array() : Buffer.from(JSON.stringify(body)),
    proof: { grantId: G, identityId: I, keyId: K, timestamp: NOW.toISOString(), signature: "" }, ...overrides };
  request.proof = { ...request.proof, signature: Buffer.from(ed.sign(canonicalMissionRequestBytes(request), privateKey)).toString("base64url") };
  return request;
}
async function enrolled(actions?: MissionAction[]) {
  const mission = await createMission({ ...target, issuerApiKeyId: A, descriptor, expiresAt: new Date(NOW.getTime() + 86_400_000).toISOString() }, options());
  const issue = await issueMissionGrant(grantInput(actions), options());
  return { ...issue, mission };
}
async function accepted(actions?: MissionAction[]) {
  const result = await enrolled(actions);
  await executeMissionRequest(req(result.token, "/accept", { mission_digest: result.mission.mission_digest }), options());
  return result;
}
async function waitForLock() {
  for (let attempt = 0; attempt < 300; attempt++) {
    const rows = await admin`SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
      AND application_name = 'collaboration-mission-service-test' AND wait_event_type = 'Lock'`;
    if (rows.length) return;
    await Bun.sleep(10);
  }
  throw new Error("service did not reach its expected database lock");
}
function barrier() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }

beforeAll(async () => {
  if (!DATABASE) return;
  const url = new URL(DATABASE);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.pathname !== "/agenttool_collaboration_missions_test" || url.search || url.hash) throw new Error("mission tests require the explicit loopback disposable database");
  admin = postgres(DATABASE, { max: 4, prepare: false, connection: { application_name: "collaboration-mission-observer-test" } });
  if ((await admin`SELECT 1 FROM pg_namespace WHERE nspname IN ('tools','identity')`).length) throw new Error("refusing existing application schemas");
  await admin.unsafe(`CREATE SCHEMA tools; CREATE SCHEMA identity;
    CREATE TABLE tools.projects (id uuid PRIMARY KEY);
    CREATE TABLE tools.api_keys (id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES tools.projects(id), revoked_at timestamptz, expires_at timestamptz);
    CREATE TABLE identity.identities (id uuid PRIMARY KEY, project_id uuid NOT NULL, status text NOT NULL);
    CREATE TABLE identity.identity_keys (id uuid PRIMARY KEY, identity_id uuid NOT NULL REFERENCES identity.identities(id), public_key text NOT NULL, active boolean NOT NULL, revoked_at timestamptz);`);
  owned = true;
  await admin.unsafe(readFileSync(new URL("../../migrations/20260928T094318_collaboration_missions.sql", import.meta.url), "utf8"));
  // Legacy rows exist before the renewal migration, as in production.
  await admin.unsafe(LEGACY_SEED);
  await admin.unsafe(readFileSync(new URL("../../migrations/20261027T134854_collaboration_grant_renewal.sql", import.meta.url), "utf8"));
  legacyRows = await admin`SELECT * FROM tools.collaboration_grants ORDER BY id`;
  service = postgres(DATABASE, { max: 8, prepare: false, connection: { application_name: "collaboration-mission-service-test" } });
  locker = postgres(DATABASE, { max: 1, prepare: false, connection: { application_name: "collaboration-mission-locker-test" } });
  database = drizzle(service);
});
beforeEach(async () => {
  if (!owned) return;
  await admin.unsafe("DELETE FROM tools.collaboration_events; DELETE FROM tools.collaboration_grants; DELETE FROM tools.collaboration_missions; DELETE FROM identity.identity_keys; DELETE FROM identity.identities; DELETE FROM tools.api_keys; DELETE FROM tools.projects;");
  await admin`INSERT INTO tools.projects (id) VALUES (${P}), (${O})`;
  await admin`INSERT INTO tools.api_keys (id,project_id) VALUES (${A},${P}), (${B},${P}), (${O},${O})`;
  await admin`INSERT INTO identity.identities (id,project_id,status) VALUES (${I},${P},'active'),(${J},${P},'active'),(${O},${O},'active')`;
  await admin`INSERT INTO identity.identity_keys (id,identity_id,public_key,active) VALUES (${K},${I},${PUBLIC},true),(${L},${J},${OTHER_PUBLIC},true),(${O},${O},${OTHER_PUBLIC},true)`;
});
afterAll(async () => {
  await service?.end({ timeout: 2 }); await locker?.end({ timeout: 2 });
  if (owned) await admin.unsafe("DROP SCHEMA tools CASCADE; DROP SCHEMA identity CASCADE;");
  await admin?.end({ timeout: 2 });
});

databaseTest("invitation is private to its subject, acceptance is explicit, and token issuance is unrecoverable", async () => {
  const { token, mission } = await enrolled();
  const invite = await executeMissionRequest(req(token, "/invitation"), options());
  expect(invite.data).toHaveProperty("mission"); expect(invite.data).not.toHaveProperty("events");
  await expect(executeMissionRequest(req(token, "/context"), options())).rejects.toMatchObject({ status: 403 });
  await expect(executeMissionRequest(req(token, "/events", { event_id: E, summary: "not accepted" }), options())).rejects.toMatchObject({ status: 403 });
  await expect(executeMissionRequest(req(token, "/accept", { mission_digest: `sha256:${"0".repeat(64)}` }), options())).rejects.toMatchObject({ status: 409 });
  const acceptance = req(token, "/accept", { mission_digest: mission.mission_digest });
  const first = await executeMissionRequest(acceptance, options());
  expect(first.created).toBe(true); expect((await executeMissionRequest(acceptance, options())).created).toBe(false);
  expect((await executeMissionRequest(req(token, "/context"), options())).data.mission).toEqual(mission);
  await expect(issueMissionGrant(grantInput(), options())).rejects.toMatchObject({ status: 409 });
  const metadata = await getMissionGrant({ ...target, grantId: G }, options());
  expect(metadata.accepted_at).toBe(NOW.toISOString()); expect(JSON.stringify(metadata)).not.toContain(token);
  const rows = await admin`SELECT * FROM tools.collaboration_grants`;
  expect(rows).toHaveLength(1); expect(JSON.stringify(rows)).not.toContain(token); expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
  await expect(executeMissionRequest(req(token, "/invitation", undefined, { proof: { ...acceptance.proof, identityId: J, keyId: L } }, OTHER_PRIVATE), options())).rejects.toMatchObject({ status: 401 });
});

databaseTest("a participant-chosen token hash binds the grant, returns no token, and is globally unique", async () => {
  const mission = await createMission({ ...target, issuerApiKeyId: A, descriptor, expiresAt: new Date(NOW.getTime() + 86_400_000).toISOString() }, options());
  const token = `atcm_${Buffer.alloc(32, 11).toString("base64url")}`, hash = createHash("sha256").update(token, "utf8").digest("hex");
  const issued = await issueMissionGrant({ ...grantInput(), tokenSha256: hash }, options());
  expect(issued).toEqual({ grant: expect.objectContaining({ grant_id: G }), token_sha256: hash, token_source: "participant" });
  expect(JSON.stringify(issued)).not.toContain("atcm_");
  expect((await admin`SELECT token_hash FROM tools.collaboration_grants WHERE id = ${G}`)[0].token_hash).toBe(hash);
  expect((await executeMissionRequest(req(token, "/accept", { mission_digest: mission.mission_digest }), options())).created).toBe(true);
  expect((await executeMissionRequest(req(token, "/context"), options())).data.mission).toEqual(mission);
  await expect(issueMissionGrant({ ...grantInput(), grantId: H, tokenSha256: hash }, options())).rejects.toMatchObject({ status: 409, code: "token_hash_conflict" });
  await expect(issueMissionGrant({ ...grantInput(), tokenSha256: "d".repeat(64) }, options())).rejects.toMatchObject({ status: 409, code: "collaboration_mission_conflict" });
  const elsewhere = uid(30);
  await createMission({ projectId: O, missionId: elsewhere, issuerApiKeyId: O, descriptor, expiresAt: new Date(NOW.getTime() + 86_400_000).toISOString() }, options());
  await expect(issueMissionGrant({ projectId: O, missionId: elsewhere, issuerApiKeyId: O, grantId: uid(31), identityId: O, signingKeyId: O, origin: ORIGIN, actions: ["mission.read"], expiresAt: END.toISOString(), tokenSha256: hash }, options()))
    .rejects.toMatchObject({ status: 409, code: "token_hash_conflict" });
  expect((await admin`SELECT count(*)::int AS n FROM tools.collaboration_grants`)[0].n).toBe(1);
});

databaseTest("concurrent issuance of one participant hash has exactly one durable winner", async () => {
  await createMission({ ...target, issuerApiKeyId: A, descriptor, expiresAt: new Date(NOW.getTime() + 86_400_000).toISOString() }, options());
  const hash = "e".repeat(64);
  const results = await Promise.allSettled([issueMissionGrant({ ...grantInput(), tokenSha256: hash }, options()), issueMissionGrant({ ...grantInput(), grantId: H, tokenSha256: hash }, options())]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect((results.find(r => r.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ status: 409, code: "token_hash_conflict" });
  expect((await admin`SELECT count(*)::int AS n FROM tools.collaboration_grants`)[0].n).toBe(1);
});

databaseTest("a participant leaves only its own grant, idempotently, and its token is then refused everywhere", async () => {
  const { token, mission } = await accepted();
  const peer = await issueMissionGrant({ ...grantInput(["mission.read"]), grantId: H, identityId: J, signingKeyId: L }, options());
  const peerProof = { grantId: H, identityId: J, keyId: L, timestamp: NOW.toISOString(), signature: "" };
  await executeMissionRequest(req(peer.token, "/accept", { mission_digest: mission.mission_digest }, { proof: peerProof }, OTHER_PRIVATE), options());
  // The peer's key and token cannot remove this grant, and this token cannot remove the peer's.
  await expect(executeMissionRequest(req(peer.token, "/leave", undefined, { method: "POST", proof: { ...peerProof, grantId: G } }, OTHER_PRIVATE), options())).rejects.toMatchObject({ status: 401 });
  await expect(executeMissionRequest(req(token, "/leave", undefined, { method: "POST", proof: peerProof }, OTHER_PRIVATE), options())).rejects.toMatchObject({ status: 401 });
  await expect(executeMissionRequest(req(token, "/leave", undefined, { method: "POST" }, OTHER_PRIVATE), options())).rejects.toMatchObject({ status: 401 });
  const leave = req(token, "/leave", undefined, { method: "POST" });
  const first = await executeMissionRequest(leave, options());
  expect(first).toEqual({ created: true, data: { mission_id: M, grant_id: G, status: "revoked", reason: "participant_left", revoked_at: NOW.toISOString() } });
  const later = new Date(NOW.getTime() + 1000);
  const repeat = req(token, "/leave", undefined, { method: "POST", proof: { ...leave.proof, timestamp: later.toISOString() } });
  expect(await executeMissionRequest(repeat, { database, now: later })).toEqual({ created: false, data: first.data });
  const [stored] = await admin`SELECT revoked_at, acceptance_proof FROM tools.collaboration_grants WHERE id = ${G}`;
  expect(stored.revoked_at.toISOString()).toBe(NOW.toISOString());
  expect(stored.acceptance_proof.request_target).toBe(`${BASE}/accept`);
  expect(stored.acceptance_proof.participant_leave).toMatchObject({ reason: "participant_left", request_target: `${BASE}/leave`, raw_body: "", signature: leave.proof.signature });
  expect(verifyMissionProof({ ...leave, bodyBytes: Buffer.from(stored.acceptance_proof.participant_leave.raw_body, "utf8") }, stored.acceptance_proof.participant_leave.public_key, NOW)).toBe(true);
  for (const [path, body] of [["/invitation", undefined], ["/context", undefined], ["/events", undefined], ["/events", { event_id: E, summary: "after leaving" }], ["/accept", { mission_digest: mission.mission_digest }]] as const) {
    await expect(executeMissionRequest(req(token, path, body), options())).rejects.toMatchObject({ status: 401 });
  }
  expect((await getMissionGrant({ ...target, grantId: G }, options())).revocation_reason).toBe("participant_left");
  expect((await revokeMissionGrant({ ...target, grantId: G }, options())).revoked_at).toBe(NOW.toISOString());
  const peerView = await getMissionGrant({ ...target, grantId: H }, options());
  expect(peerView.revoked_at).toBeNull(); expect(peerView).not.toHaveProperty("revocation_reason");
  expect((await executeMissionRequest(req(peer.token, "/context", undefined, { proof: peerProof }, OTHER_PRIVATE), options())).data.mission).toEqual(mission);
  expect((await revokeMission(target, options())).revoked_at).toBe(NOW.toISOString());
  await expect(executeMissionRequest(req(peer.token, "/context", undefined, { proof: peerProof }, OTHER_PRIVATE), options())).rejects.toMatchObject({ status: 401 });
  await expect(executeMissionRequest(repeat, { database, now: later })).rejects.toMatchObject({ status: 401 });
});

databaseTest("leave requires acceptance, and an administrator revocation cannot become a participant leave", async () => {
  const { token, mission } = await enrolled();
  await expect(executeMissionRequest(req(token, "/leave", undefined, { method: "POST" }), options())).rejects.toMatchObject({ status: 403 });
  await executeMissionRequest(req(token, "/accept", { mission_digest: mission.mission_digest }), options());
  await revokeMissionGrant({ ...target, grantId: G }, options());
  await expect(executeMissionRequest(req(token, "/leave", undefined, { method: "POST" }), options())).rejects.toMatchObject({ status: 401 });
  const [stored] = await admin`SELECT acceptance_proof FROM tools.collaboration_grants WHERE id = ${G}`;
  expect(stored.acceptance_proof).not.toHaveProperty("participant_leave");
  expect(await getMissionGrant({ ...target, grantId: G }, options())).not.toHaveProperty("revocation_reason");
});

databaseTest("separate accepted identities share bounded observations and exact raw-body retries retain receipts", async () => {
  const { token, mission } = await accepted();
  const observer = await issueMissionGrant({ ...grantInput(["mission.read"]), grantId: H, identityId: J, signingKeyId: L }, options());
  const readerProof = { grantId: H, identityId: J, keyId: L, timestamp: NOW.toISOString(), signature: "" };
  await executeMissionRequest(req(observer.token, "/accept", { mission_digest: mission.mission_digest }, { proof: readerProof }, OTHER_PRIVATE), options());
  const body = { event_id: E, summary: "Selected evidence", seat: { device_id: "Mac", session_id: "session-1", harness: "codex" } };
  const original = await executeMissionRequest(req(token, "/events", body), options());
  const refreshed = req(token, "/events", body, { proof: { ...readerProof, grantId: G, identityId: I, keyId: K, timestamp: new Date(NOW.getTime() + 1000).toISOString() } });
  expect((await executeMissionRequest(refreshed, { ...options(), now: new Date(NOW.getTime() + 1000) })).data).toEqual(original.data);
  expect((await executeMissionRequest(refreshed, options())).created).toBe(false);
  await expect(executeMissionRequest(req(token, "/events", { ...body, summary: "different" }), options())).rejects.toMatchObject({ status: 409 });
  const spaced = req(token, "/events", body, { bodyBytes: Buffer.from(JSON.stringify(body) + " ") });
  await expect(executeMissionRequest(spaced, options())).rejects.toMatchObject({ status: 409 });
  const read = await executeMissionRequest(req(observer.token, "/events?after=0&limit=1", undefined, { proof: readerProof }, OTHER_PRIVATE), options());
  expect(read.data.page).toEqual({ after: "0", next_cursor: "1", has_more: false });
  expect((read.data.events as unknown[])).toHaveLength(1);
  await expect(executeMissionRequest(req(observer.token, "/events", { event_id: uid(13), summary: "unauthorized" }, { proof: readerProof }, OTHER_PRIVATE), options())).rejects.toMatchObject({ status: 401 });
  await expect(executeMissionRequest(req(token, "/events?after=2"), options())).rejects.toMatchObject({ status: 400 });
});

databaseTest("BOM-prefixed signed observations roundtrip exact bytes and fresh retries preserve receipts", async () => {
  const { token } = await accepted();
  const body = { event_id: E, summary: "Selected 雨夜 evidence" };
  const bodyBytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(body))]);
  const request = req(token, "/events", body, { bodyBytes });
  const written = await executeMissionRequest(request, options());
  const event = written.data.event as { raw_body: string; proof: { raw_body: string } };
  expect(Buffer.from(event.raw_body, "utf8")).toEqual(bodyBytes);
  expect(Buffer.from(event.proof.raw_body, "utf8")).toEqual(bodyBytes);
  expect(verifyMissionProof({ ...request, bodyBytes: Buffer.from(event.raw_body, "utf8") }, PUBLIC, NOW)).toBe(true);
  const [stored] = await admin`SELECT raw_body, proof FROM tools.collaboration_events WHERE mission_id = ${M} AND event_id = ${E}`;
  expect(Buffer.from(stored.raw_body, "utf8")).toEqual(bodyBytes);
  expect(Buffer.from(stored.proof.raw_body, "utf8")).toEqual(bodyBytes);
  const later = new Date(NOW.getTime() + 1000);
  const fresh = req(token, "/events", body, { bodyBytes, proof: { ...request.proof, timestamp: later.toISOString() } });
  const retried = await executeMissionRequest(fresh, { database, now: later });
  expect(retried.created).toBe(false);
  expect(retried.data).toEqual(written.data);
  expect((await admin`SELECT count(*)::int AS n FROM tools.collaboration_events`)[0].n).toBe(1);
});

databaseTest("BOM-prefixed acceptance retains independently verifiable signed body bytes", async () => {
  const { token, mission } = await enrolled();
  const body = { mission_digest: mission.mission_digest };
  const bodyBytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(body))]);
  const request = req(token, "/accept", body, { bodyBytes });
  expect((await executeMissionRequest(request, options())).created).toBe(true);
  const [stored] = await admin`SELECT acceptance_proof FROM tools.collaboration_grants WHERE id = ${G}`;
  expect(Buffer.from(stored.acceptance_proof.raw_body, "utf8")).toEqual(bodyBytes);
  expect(verifyMissionProof({ ...request, bodyBytes: Buffer.from(stored.acceptance_proof.raw_body, "utf8") }, PUBLIC, NOW)).toBe(true);
});

databaseTest("project, mission, key, parent, action and expiry boundaries cannot widen grants", async () => {
  const { token } = await enrolled();
  await expect(getMission({ ...target, projectId: O }, options())).rejects.toMatchObject({ status: 404 });
  await expect(getMissionGrant({ ...target, projectId: O, grantId: G }, options())).rejects.toMatchObject({ status: 404 });
  for (const bad of [{ identityId: O, signingKeyId: O }, { signingKeyId: L }, { issuerApiKeyId: O }, { missionId: O }]) {
    await expect(issueMissionGrant({ ...grantInput(), grantId: H, ...bad }, options())).rejects.toMatchObject({ status: 401 });
  }
  await expect(issueMissionGrant({ ...grantInput(), actions: ["mission.admin"] as never }, options())).rejects.toMatchObject({ status: 400 });
  await admin`UPDATE tools.api_keys SET expires_at = ${new Date(END.getTime() - 1)} WHERE id = ${A}`;
  await expect(issueMissionGrant({ ...grantInput(), grantId: H }, options())).rejects.toMatchObject({ status: 401 });
  await expect(executeMissionRequest(req(token, "/invitation"), options())).rejects.toMatchObject({ status: 401 });
  await admin`UPDATE tools.api_keys SET expires_at = NULL WHERE id = ${A}`;
  await expect(executeMissionRequest(req(token, "/invitation", undefined, { origin: "https://other.example" }), options())).rejects.toMatchObject({ status: 401 });
  await expect(executeMissionRequest(req(token, "/invitation", undefined, { missionId: O, requestTarget: `/v1/collaboration/missions/${O}/invitation` }), options())).rejects.toMatchObject({ status: 401 });
});

for (const boundary of ["grant", "mission", "parent", "key", "identity", "expiry"] as const) databaseTest(`durable retries recheck ${boundary} revocation or expiry`, async () => {
  const { token } = await accepted();
  const body = { event_id: E, summary: "once" }, write = req(token, "/events", body);
  await executeMissionRequest(write, options());
  if (boundary === "grant") await revokeMissionGrant({ ...target, grantId: G }, options());
  if (boundary === "mission") await revokeMission(target, options());
  if (boundary === "parent") await admin`UPDATE tools.api_keys SET revoked_at = ${NOW} WHERE id = ${A}`;
  if (boundary === "key") await admin`UPDATE identity.identity_keys SET active = false, revoked_at = ${NOW} WHERE id = ${K}`;
  if (boundary === "identity") await admin`UPDATE identity.identities SET status = 'retired' WHERE id = ${I}`;
  const now = boundary === "expiry" ? END : NOW;
  const fresh = req(token, "/events", body, { proof: { ...write.proof, timestamp: now.toISOString() } });
  await expect(executeMissionRequest(fresh, { ...options(), now })).rejects.toMatchObject({ status: 401 });
  expect((await admin`SELECT count(*)::int AS n FROM tools.collaboration_events`)[0].n).toBe(1);
});

databaseTest("creator provenance does not invalidate grants issued by another live parent", async () => {
  const { mission } = await enrolled();
  const alternate = await issueMissionGrant({ ...grantInput(), grantId: H, issuerApiKeyId: B }, options());
  await admin`UPDATE tools.api_keys SET revoked_at = ${NOW} WHERE id = ${A}`;
  const proof = { grantId: H, identityId: I, keyId: K, timestamp: NOW.toISOString(), signature: "" };
  expect((await executeMissionRequest(req(alternate.token, "/accept", { mission_digest: mission.mission_digest }, { proof }), options())).created).toBe(true);
});

databaseTest("event identifiers cannot replay another grant or identity's observation", async () => {
  const { token, mission } = await accepted();
  const body = { event_id: E, summary: "original" };
  await executeMissionRequest(req(token, "/events", body), options());
  for (const [grantId, identityId, signingKeyId, privateKey] of [[H, I, K, PRIVATE], [uid(20), J, L, OTHER_PRIVATE]] as const) {
    const issued = await issueMissionGrant({ ...grantInput(), grantId, identityId, signingKeyId }, options());
    const proof = { grantId, identityId, keyId: signingKeyId, timestamp: NOW.toISOString(), signature: "" };
    await executeMissionRequest(req(issued.token, "/accept", { mission_digest: mission.mission_digest }, { proof }, privateKey), options());
    await expect(executeMissionRequest(req(issued.token, "/events", body, { proof }, privateKey), options())).rejects.toMatchObject({ status: 409 });
  }
  expect((await admin`SELECT count(*)::int AS n FROM tools.collaboration_events`)[0].n).toBe(1);
});

databaseTest("future acceptance state fails closed even while the grant itself remains live", async () => {
  const { token } = await accepted();
  await admin`UPDATE tools.collaboration_grants SET accepted_at = ${new Date(NOW.getTime() + 1000)} WHERE id = ${G}`;
  await expect(executeMissionRequest(req(token, "/context"), options())).rejects.toMatchObject({ status: 401 });
});

databaseTest("migration constraints reject invalid acceptance pairs, action arrays and authority graph deletion", async () => {
  await enrolled();
  for (const sql of [
    "UPDATE tools.collaboration_grants SET acceptance_proof = '{}'::jsonb",
    "UPDATE tools.collaboration_grants SET accepted_at = issued_at",
    "UPDATE tools.collaboration_grants SET actions = ARRAY['mission.admin']",
    "UPDATE tools.collaboration_grants SET actions = '[0:1]={mission.read,mission.read}'::text[]",
    "UPDATE tools.collaboration_grants SET actions = ARRAY[['mission.read','mission.observe']]",
    "UPDATE tools.collaboration_grants SET expires_at = 'infinity'",
    "UPDATE tools.collaboration_grants SET expires_at = issued_at + interval '25 hours'",
    "UPDATE tools.collaboration_missions SET expires_at = created_at + interval '31 days'",
  ]) await expect(Promise.resolve(admin.unsafe(sql))).rejects.toMatchObject({ code: "23514" });
  await expect(Promise.resolve(admin`DELETE FROM tools.api_keys WHERE id = ${A}`)).rejects.toMatchObject({ code: "23503" });
});

databaseTest("concurrent issuance, acceptance, distinct appends and identical retries have durable winners", async () => {
  const { mission } = await enrolled();
  const issued = await Promise.allSettled([issueMissionGrant({ ...grantInput(), grantId: H }, options()), issueMissionGrant({ ...grantInput(), grantId: H }, options())]);
  expect(issued.filter(r => r.status === "fulfilled")).toHaveLength(1);
  const token = (issued.find(r => r.status === "fulfilled") as PromiseFulfilledResult<ServerIssuedMissionGrant>).value.token;
  const proof = { grantId: H, identityId: I, keyId: K, timestamp: NOW.toISOString(), signature: "" };
  const acceptance = req(token, "/accept", { mission_digest: mission.mission_digest }, { proof });
  const accepts = await Promise.all([executeMissionRequest(acceptance, options()), executeMissionRequest(acceptance, options())]);
  expect(accepts.map(r => r.created).sort()).toEqual([false, true]);
  const writes = await Promise.all([E, uid(13)].map(event_id => executeMissionRequest(req(token, "/events", { event_id, summary: "parallel" }, { proof }), options())));
  expect(writes.every(r => r.created)).toBe(true);
  const retry = req(token, "/events", { event_id: uid(14), summary: "retry" }, { proof });
  const retries = await Promise.all([executeMissionRequest(retry, options()), executeMissionRequest(retry, options())]);
  expect(retries.map(r => r.created).sort()).toEqual([false, true]);
  expect(retries[0].data).toEqual(retries[1].data);
  expect((await admin`SELECT last_receipt_seq::int AS seq FROM tools.collaboration_missions WHERE id = ${M}`)[0].seq).toBe(3);
});

for (const boundary of ["grant", "mission", "parent", "key", "identity"] as const) databaseTest(`admission waiting behind ${boundary} revocation observes the committed denial`, async () => {
  const { token } = await accepted();
  const held = barrier(), release = barrier();
  const transaction = locker.begin(async tx => {
    if (boundary === "grant") await tx`UPDATE tools.collaboration_grants SET revoked_at = ${NOW} WHERE id = ${G}`;
    if (boundary === "mission") await tx`UPDATE tools.collaboration_missions SET revoked_at = ${NOW} WHERE id = ${M}`;
    if (boundary === "parent") await tx`UPDATE tools.api_keys SET revoked_at = ${NOW} WHERE id = ${A}`;
    if (boundary === "key") await tx`UPDATE identity.identity_keys SET active = false, revoked_at = ${NOW} WHERE id = ${K}`;
    if (boundary === "identity") await tx`UPDATE identity.identities SET status = 'retired' WHERE id = ${I}`;
    held.resolve(); await release.promise;
  });
  await held.promise;
  const pending = executeMissionRequest(req(token, "/events", { event_id: E, summary: "late" }), options());
  const result = pending.then(() => ({ status: 200 }), error => ({ status: error.status }));
  try { await waitForLock(); } finally { release.resolve(); }
  await transaction;
  expect(await result).toEqual({ status: 401 });
  expect((await admin`SELECT count(*)::int AS n FROM tools.collaboration_events`)[0].n).toBe(0);
});

databaseTest("expiry clock is sampled after lock waits, and readers cannot reuse an expired proof", async () => {
  const { token } = await accepted();
  const held = barrier(), release = barrier(); let clock = NOW;
  const transaction = locker.begin(async tx => { await tx`SELECT id FROM tools.collaboration_missions WHERE id = ${M} FOR UPDATE`; held.resolve(); await release.promise; });
  await held.promise;
  const pending = executeMissionRequest(req(token, "/context"), { database, now: () => clock }).then(() => 200, error => error.status);
  try { await waitForLock(); clock = END; } finally { release.resolve(); }
  await transaction; expect(await pending).toBe(401);
});

databaseTest("a proof that expires during a lock wait fails while its grant remains unexpired", async () => {
  const { token } = await accepted();
  const held = barrier(), release = barrier(); let clock = NOW;
  const transaction = locker.begin(async tx => { await tx`SELECT id FROM tools.collaboration_missions WHERE id = ${M} FOR UPDATE`; held.resolve(); await release.promise; });
  await held.promise;
  const pending = executeMissionRequest(req(token, "/events", { event_id: E, summary: "stale proof" }), { database, now: () => clock }).then(() => 200, error => error.status);
  try { await waitForLock(); clock = new Date(NOW.getTime() + 300001); } finally { release.resolve(); }
  await transaction; expect(await pending).toBe(401);
  expect((await admin`SELECT count(*)::int AS n FROM tools.collaboration_events`)[0].n).toBe(0);
});

databaseTest("an already admitted append commits before revocation, which then denies all later admissions", async () => {
  const { token } = await accepted();
  const admitted = barrier(), commit = barrier();
  const delayedDatabase = {
    transaction: (callback: Parameters<typeof database.transaction>[0]) => database.transaction(async tx => {
      const result = await callback(tx);
      admitted.resolve(); await commit.promise;
      return result;
    }),
  };
  const write = req(token, "/events", { event_id: E, summary: "admitted before revoke" });
  const writing = executeMissionRequest(write, { database: delayedDatabase as typeof database, now: NOW });
  await admitted.promise;
  const revoking = revokeMissionGrant({ ...target, grantId: G }, options());
  try { await waitForLock(); } finally { commit.resolve(); }
  expect((await writing).created).toBe(true);
  expect((await revoking).revoked_at).toBe(NOW.toISOString());
  await expect(executeMissionRequest(write, options())).rejects.toMatchObject({ status: 401 });
  expect((await admin`SELECT count(*)::int AS n FROM tools.collaboration_events`)[0].n).toBe(1);
});

// ── Renewal inside an administrator-set window ─────────────────────────────
const HALF = new Date(NOW.getTime() + 1_800_000), WINDOW = new Date(NOW.getTime() + 6 * 3_600_000);
const freshToken = () => `atcm_${randomBytes(32).toString("base64url")}`;
const at = (date: Date) => ({ database, now: date });
/** A signed renew of `grantId` (holding `token`) into `child` with `childToken`'s hash, at `time`. */
function renewReq(token: string, grantId: string, child: string, childToken: string, time = HALF, digest = DIGEST) {
  return req(token, "/renew", { grant_id: child, mission_digest: digest, token_sha256: sha(childToken) },
    { proof: { grantId, identityId: I, keyId: K, timestamp: time.toISOString(), signature: "" } });
}
async function renewableRoot(renewableUntil = WINDOW, missionAgeMs = 86_400_000) {
  const mission = await createMission({ ...target, issuerApiKeyId: A, descriptor, expiresAt: new Date(NOW.getTime() + missionAgeMs).toISOString() }, options());
  const issued = await issueMissionGrant({ ...grantInput(), renewableUntil: renewableUntil.toISOString() }, options()) as ServerIssuedMissionGrant;
  await executeMissionRequest(req(issued.token, "/accept", { mission_digest: mission.mission_digest }), options());
  return { token: issued.token, grant: issued.grant, mission };
}
const unrevokedMembers = async () => (await admin`SELECT count(*)::int AS n FROM tools.collaboration_grants WHERE renewal_root_id = ${G} AND revoked_at IS NULL`)[0].n;
const membersAt = async (time: Date) => (await admin`SELECT count(*)::int AS n FROM tools.collaboration_grants
  WHERE renewal_root_id = ${G} AND revoked_at IS NULL AND issued_at <= ${time} AND expires_at > ${time}`)[0].n;
async function resetMissions() { await admin.unsafe("DELETE FROM tools.collaboration_events; DELETE FROM tools.collaboration_grants; DELETE FROM tools.collaboration_missions;"); }
/** Holds a callback's transaction open after its work, so a competitor queues behind its locks. */
function delayed() {
  const done = barrier(), commit = barrier();
  const handle = { transaction: (callback: Parameters<typeof database.transaction>[0], config?: Parameters<typeof database.transaction>[1]) =>
    database.transaction(async tx => { try { return await callback(tx); } finally { done.resolve(); await commit.promise; } }, config) };
  return { handle: handle as unknown as typeof database, done: done.promise, commit: commit.resolve };
}
const outcome = (promise: Promise<unknown>) => promise.then(value => ({ status: 200, value }), error => ({ status: error.status as number, code: error.code as string, error }));

databaseTest("the renewal migration applies over legacy rows, which still admit, accept, leave and revoke", async () => {
  expect(legacyRows).toHaveLength(1);
  expect(legacyRows[0]).toMatchObject({ id: G, renewable_until: null, renewal_closed_at: null, renewal_root_id: null, renewed_from_grant_id: null });
  // Old code on the new schema: its insert names none of the renewal columns.
  await admin.unsafe(LEGACY_MISSION + legacyGrantInsert);
  const invite = await executeMissionRequest(req(LEGACY_TOKEN, "/invitation"), options());
  expect(invite.data.grant).not.toHaveProperty("renewal");
  expect((await executeMissionRequest(req(LEGACY_TOKEN, "/accept", { mission_digest: DIGEST }), options())).created).toBe(true);
  await expect(executeMissionRequest(renewReq(LEGACY_TOKEN, G, H, freshToken(), NOW), options())).rejects.toMatchObject({ status: 403, code: "collaboration_mission_renewal_unavailable" });
  expect((await executeMissionRequest(req(LEGACY_TOKEN, "/leave", undefined, { method: "POST" }), options())).created).toBe(true);
  expect(await revokeMissionGrant({ ...target, grantId: G }, options())).toMatchObject({ revoked_at: NOW.toISOString(), revocation_reason: "participant_left" });
  expect(await closeMissionGrantRenewal({ ...target, grantId: G }, options())).not.toHaveProperty("renewal");
});

databaseTest("a renewable root references itself and renews into a born-accepted child with the same scope", async () => {
  const { token, grant } = await renewableRoot();
  expect(grant.renewal).toEqual({ root_grant_id: G, renewed_from_grant_id: null, renewed_to_grant_id: null, renewable_until: WINDOW.toISOString(), closed_at: null });
  expect((await admin`SELECT renewal_root_id FROM tools.collaboration_grants WHERE id = ${G}`)[0].renewal_root_id).toBe(G);
  await expect(executeMissionRequest(renewReq(token, G, H, freshToken(), new Date(HALF.getTime() - 1)), at(new Date(HALF.getTime() - 1)))).rejects.toMatchObject({ status: 403 });
  const childToken = freshToken(), request = renewReq(token, G, H, childToken);
  const renewed = await executeMissionRequest(request, at(HALF));
  expect(renewed.created).toBe(true);
  expect(renewed.data).toMatchObject({ token_sha256: sha(childToken), token_source: "participant",
    grant: { grant_id: H, accepted_at: HALF.toISOString(), issued_at: HALF.toISOString(), expires_at: new Date(HALF.getTime() + 3_600_000).toISOString(),
      actions: ["mission.observe", "mission.read"], renewal: { root_grant_id: G, renewed_from_grant_id: G, renewed_to_grant_id: null, renewable_until: WINDOW.toISOString(), closed_at: null } } });
  expect(JSON.stringify(renewed.data)).not.toContain(childToken);
  // The stored proof re-verifies on its own through signed_grant_id.
  const [stored] = await admin`SELECT acceptance_proof FROM tools.collaboration_grants WHERE id = ${H}`;
  const proof = stored.acceptance_proof;
  expect(proof.signed_grant_id).toBe(G);
  expect(verifyMissionProof({ token: "", missionId: M, origin: proof.origin, method: proof.method, requestTarget: proof.request_target,
    bodyBytes: Buffer.from(proof.raw_body, "utf8"), proof: { grantId: proof.signed_grant_id, identityId: I, keyId: K, timestamp: proof.timestamp, signature: proof.signature } }, proof.public_key, HALF)).toBe(true);
  // The child works at once, and a later explicit accept is harmless.
  const childProof = { grantId: H, identityId: I, keyId: K, timestamp: HALF.toISOString(), signature: "" };
  expect((await executeMissionRequest(req(childToken, "/context", undefined, { proof: childProof }), at(HALF))).data.grant).toMatchObject({ grant_id: H });
  expect((await executeMissionRequest(req(childToken, "/accept", { mission_digest: DIGEST }, { proof: childProof }), at(HALF))).created).toBe(false);
  expect((await getMissionGrant({ ...target, grantId: G }, options())).renewal?.renewed_to_grant_id).toBe(H);
  // An exact retry with a fresh proof returns the same child; anything else conflicts.
  const later = new Date(HALF.getTime() + 1000);
  const retry = await executeMissionRequest(renewReq(token, G, H, childToken, later), at(later));
  expect(retry).toEqual({ created: false, data: { ...renewed.data } });
  await expect(executeMissionRequest(renewReq(token, G, E, freshToken(), later), at(later))).rejects.toMatchObject({ status: 409, code: "collaboration_mission_conflict" });
  await expect(executeMissionRequest(renewReq(token, G, H, childToken, later, `sha256:${"0".repeat(64)}`), at(later))).rejects.toMatchObject({ status: 409 });
  // Close keeps exact retry working while G lives, but stops new renewals of the head.
  await closeMissionGrantRenewal({ ...target, grantId: H }, at(later));
  expect((await executeMissionRequest(renewReq(token, G, H, childToken, later), at(later))).created).toBe(false);
  const head = new Date(HALF.getTime() + 1_800_000);
  await expect(executeMissionRequest(renewReq(childToken, H, E, freshToken(), head), at(head))).rejects.toMatchObject({ status: 403, code: "collaboration_mission_renewal_unavailable" });
  expect((await admin`SELECT count(*)::int AS n FROM tools.collaboration_grants WHERE renewal_closed_at = ${later}`)[0].n).toBe(2);
  // A captured renew replayed after revocation is refused, not answered with the stored child.
  await revokeMissionGrant({ ...target, grantId: G }, at(later));
  await expect(executeMissionRequest(renewReq(token, G, H, childToken, later), at(later))).rejects.toMatchObject({ status: 401 });
  expect(await unrevokedMembers()).toBe(0);
});

databaseTest("a successor opens at its own halfway, not the root's, so a chain cannot be minted in a burst", async () => {
  const { token } = await renewableRoot();
  const childToken = freshToken();
  await executeMissionRequest(renewReq(token, G, H, childToken), at(HALF));
  const soon = new Date(HALF.getTime() + 1000);
  await expect(executeMissionRequest(renewReq(childToken, H, E, freshToken(), soon), at(soon))).rejects.toMatchObject({ status: 403, code: "collaboration_mission_renewal_unavailable" });
  expect((await admin`SELECT count(*)::int AS n FROM tools.collaboration_grants WHERE renewal_root_id = ${G}`)[0].n).toBe(2);
  // H was born at HALF for one hour: it opens 30 minutes later.
  const open = new Date(HALF.getTime() + 1_800_000);
  expect((await executeMissionRequest(renewReq(childToken, H, E, freshToken(), open), at(open))).created).toBe(true);
});

// Code at a99257ab revokes or leaves one row and leaves the window open (rollback, or an
// old Machine mid-rollout). Any revoked member then refuses renewal of the rest.
const legacyRevoke = (id: string, time: Date) => admin`UPDATE tools.collaboration_grants SET revoked_at = ${time} WHERE id = ${id}`;
databaseTest("a root revoked by one-row legacy code refuses renewal of its live successor", async () => {
  const { token } = await renewableRoot();
  const childToken = freshToken();
  await executeMissionRequest(renewReq(token, G, H, childToken), at(HALF));
  await legacyRevoke(G, HALF);
  const open = new Date(HALF.getTime() + 1_800_000);
  await expect(executeMissionRequest(renewReq(childToken, H, E, freshToken(), open), at(open))).rejects.toMatchObject({ status: 403, code: "collaboration_mission_renewal_unavailable" });
  expect((await admin`SELECT count(*)::int AS n FROM tools.collaboration_grants WHERE renewal_root_id = ${G}`)[0].n).toBe(2);
});
databaseTest("a middle member revoked by one-row legacy code refuses renewal of the head", async () => {
  const { token } = await renewableRoot();
  const childToken = freshToken(), headToken = freshToken(), open = new Date(HALF.getTime() + 1_800_000);
  await executeMissionRequest(renewReq(token, G, H, childToken), at(HALF));
  await executeMissionRequest(renewReq(childToken, H, E, headToken, open), at(open));
  await legacyRevoke(H, open);
  const headOpen = new Date(open.getTime() + 1_800_000), next = uid(43);
  await expect(executeMissionRequest(renewReq(headToken, E, next, freshToken(), headOpen), at(headOpen))).rejects.toMatchObject({ status: 403, code: "collaboration_mission_renewal_unavailable" });
  expect((await admin`SELECT count(*)::int AS n FROM tools.collaboration_grants WHERE id = ${next}`)[0].n).toBe(0);
});

databaseTest("an event retried by a later member of the same chain returns its original receipt", async () => {
  const { token } = await renewableRoot();
  const childToken = freshToken(), event = uid(44), body = { event_id: event, summary: "sent before renewal" };
  const original = await executeMissionRequest(req(token, "/events", body), options());
  expect(original.created).toBe(true);
  await executeMissionRequest(renewReq(token, G, H, childToken), at(HALF));
  const asChild = req(childToken, "/events", body, { proof: { grantId: H, identityId: I, keyId: K, timestamp: HALF.toISOString(), signature: "" } });
  expect(await executeMissionRequest(asChild, at(HALF))).toEqual({ created: false, data: original.data });
  // Different bytes from the same chain still conflict.
  const changed = req(childToken, "/events", { ...body, summary: "different" }, { proof: { grantId: H, identityId: I, keyId: K, timestamp: HALF.toISOString(), signature: "" } });
  await expect(executeMissionRequest(changed, at(HALF))).rejects.toMatchObject({ status: 409, code: "collaboration_mission_conflict" });
  // A grant of the same identity and key outside the chain does not inherit the receipt.
  const otherToken = freshToken(), other = uid(45);
  await issueMissionGrant({ ...grantInput(), grantId: other, tokenSha256: sha(otherToken) }, at(HALF));
  const otherProof = { grantId: other, identityId: I, keyId: K, timestamp: HALF.toISOString(), signature: "" };
  await executeMissionRequest(req(otherToken, "/accept", { mission_digest: DIGEST }, { proof: otherProof }), at(HALF));
  await expect(executeMissionRequest(req(otherToken, "/events", body, { proof: otherProof }), at(HALF))).rejects.toMatchObject({ status: 409, code: "collaboration_mission_conflict" });
  expect((await admin`SELECT count(*)::int AS n FROM tools.collaboration_events`)[0].n).toBe(1);
});

databaseTest("migration constraints keep a chain linear and within its root's whole scope", async () => {
  const { token } = await renewableRoot();
  await executeMissionRequest(renewReq(token, G, H, freshToken()), at(HALF));
  const copy = (id: string, change: string, from = G) => `INSERT INTO tools.collaboration_grants (id, project_id, mission_id, identity_id, signing_key_id, issuing_api_key_id, token_hash, origin, actions,
    issued_at, expires_at, accepted_at, acceptance_proof, revoked_at, renewable_until, renewal_root_id, renewed_from_grant_id)
    SELECT '${id}', project_id, mission_id, identity_id, signing_key_id, issuing_api_key_id, '${"f".repeat(64)}', origin, actions,
    issued_at, expires_at, issued_at, '{}'::jsonb, NULL, renewable_until, renewal_root_id, '${from}' FROM tools.collaboration_grants WHERE id = '${H}'; ${change}`;
  await admin`INSERT INTO identity.identity_keys (id, identity_id, public_key, active) VALUES (${uid(40)}, ${I}, ${OTHER_PUBLIC}, true)`;
  for (const change of [
    `UPDATE tools.collaboration_grants SET actions = ARRAY['mission.read'] WHERE id = '${uid(41)}'`,
    `UPDATE tools.collaboration_grants SET origin = 'https://other.example' WHERE id = '${uid(41)}'`,
    `UPDATE tools.collaboration_grants SET issuing_api_key_id = '${B}' WHERE id = '${uid(41)}'`,
    `UPDATE tools.collaboration_grants SET signing_key_id = '${uid(40)}' WHERE id = '${uid(41)}'`,
    `UPDATE tools.collaboration_grants SET identity_id = '${J}', signing_key_id = '${L}' WHERE id = '${uid(41)}'`,
  ]) await expect(Promise.resolve(admin.begin(tx => tx.unsafe(copy(uid(41), change, H))))).rejects.toMatchObject({ code: "23503" });
  // A second child of one predecessor, a window without a root, and a child accepted later than issued.
  await expect(Promise.resolve(admin.unsafe(copy(uid(42), "")))).rejects.toMatchObject({ code: "23505" });
  for (const sql of [
    `UPDATE tools.collaboration_grants SET renewal_root_id = NULL, renewed_from_grant_id = NULL WHERE id = '${H}'`,
    `UPDATE tools.collaboration_grants SET accepted_at = issued_at + interval '1 second' WHERE id = '${H}'`,
    `UPDATE tools.collaboration_grants SET renewable_until = expires_at - interval '1 second' WHERE id = '${H}'`,
    `UPDATE tools.collaboration_grants SET renewable_until = issued_at + interval '31 days' WHERE id = '${G}'`,
    `UPDATE tools.collaboration_grants SET renewal_closed_at = issued_at - interval '1 second' WHERE id = '${G}'`,
    `UPDATE tools.collaboration_grants SET renewal_closed_at = 'infinity' WHERE id = '${G}'`,
  ]) await expect(Promise.resolve(admin.unsafe(sql))).rejects.toMatchObject({ code: "23514" });
});

databaseTest("one leave ends the chain; each member's own later leave reads back participant_left", async () => {
  const { token } = await renewableRoot();
  const childToken = freshToken();
  await executeMissionRequest(renewReq(token, G, H, childToken), at(HALF));
  const proofFor = (grantId: string) => ({ grantId, identityId: I, keyId: K, timestamp: HALF.toISOString(), signature: "" });
  const left = await executeMissionRequest(req(childToken, "/leave", undefined, { method: "POST", proof: proofFor(H) }), at(HALF));
  expect(left).toEqual({ created: true, data: { mission_id: M, grant_id: H, status: "revoked", reason: "participant_left", revoked_at: HALF.toISOString() } });
  // The predecessor carries only an unsigned pointer; its own leave returns its own revoked_at.
  const sibling = await executeMissionRequest(req(token, "/leave", undefined, { method: "POST", proof: proofFor(G) }), at(HALF));
  expect(sibling).toEqual({ created: false, data: { mission_id: M, grant_id: G, status: "revoked", reason: "participant_left", revoked_at: HALF.toISOString() } });
  const [root] = await admin`SELECT acceptance_proof, renewal_closed_at FROM tools.collaboration_grants WHERE id = ${G}`;
  expect(root.acceptance_proof.participant_leave).toEqual({ reason: "participant_left", via_grant_id: H });
  expect(root.renewal_closed_at.toISOString()).toBe(HALF.toISOString());
  for (const grantId of [G, H]) expect((await getMissionGrant({ ...target, grantId }, options())).revocation_reason).toBe("participant_left");
  expect(await unrevokedMembers()).toBe(0);
  // An administrator-revoked chain cannot be relabelled as left.
  await resetMissions();
  const again = await renewableRoot();
  await executeMissionRequest(renewReq(again.token, G, H, childToken), at(HALF));
  await revokeMissionGrant({ ...target, grantId: G }, at(HALF));
  await expect(executeMissionRequest(req(childToken, "/leave", undefined, { method: "POST", proof: proofFor(H) }), at(HALF))).rejects.toMatchObject({ status: 401 });
  expect(await getMissionGrant({ ...target, grantId: H }, options())).not.toHaveProperty("revocation_reason");
});

databaseTest("a successor needs a fresh hash: the presented token's or any bound hash conflicts", async () => {
  const { token } = await renewableRoot();
  await expect(executeMissionRequest(renewReq(token, G, H, token), at(HALF))).rejects.toMatchObject({ status: 409, code: "token_hash_conflict" });
  const peer = freshToken();
  await issueMissionGrant({ ...grantInput(["mission.read"]), grantId: E, identityId: J, signingKeyId: L, tokenSha256: sha(peer) }, options());
  await expect(executeMissionRequest(renewReq(token, G, H, peer), at(HALF))).rejects.toMatchObject({ status: 409, code: "token_hash_conflict" });
  await expect(executeMissionRequest(renewReq(token, G, E, freshToken()), at(HALF))).rejects.toMatchObject({ status: 409, code: "collaboration_mission_conflict" });
  expect((await admin`SELECT count(*)::int AS n FROM tools.collaboration_grants`)[0].n).toBe(2);
});

databaseTest("concurrent renewals of one grant have one durable successor", async () => {
  const { token } = await renewableRoot();
  const distinct = await Promise.all([renewReq(token, G, H, freshToken()), renewReq(token, G, E, freshToken())].map(r => outcome(executeMissionRequest(r, at(HALF)))));
  expect(distinct.map(r => r.status).sort()).toEqual([200, 409]);
  await resetMissions();
  const again = await renewableRoot(), request = renewReq(again.token, G, H, freshToken());
  const same = await Promise.all([executeMissionRequest(request, at(HALF)), executeMissionRequest(request, at(HALF))]);
  expect(same.map(r => r.created).sort()).toEqual([false, true]);
  expect(same[0].data).toEqual(same[1].data);
  expect((await admin`SELECT count(*)::int AS n FROM tools.collaboration_grants`)[0].n).toBe(2);
});

for (const competitor of ["revoke", "close", "leave", "mission"] as const) for (const first of ["renew", competitor] as const) {
  databaseTest(`renew racing ${competitor}, ${first} committing first, leaves no escaped authority`, async () => {
    const { token } = await renewableRoot();
    const childToken = freshToken(), hold = delayed();
    const run = (who: string, database_: typeof database) => who === "renew" ? executeMissionRequest(renewReq(token, G, H, childToken), { database: database_, now: HALF })
      : competitor === "revoke" ? revokeMissionGrant({ ...target, grantId: G }, { database: database_, now: HALF })
      : competitor === "close" ? closeMissionGrantRenewal({ ...target, grantId: G }, { database: database_, now: HALF })
      : competitor === "leave" ? executeMissionRequest(req(token, "/leave", undefined, { method: "POST", proof: { grantId: G, identityId: I, keyId: K, timestamp: HALF.toISOString(), signature: "" } }), { database: database_, now: HALF })
      : revokeMission(target, { database: database_, now: HALF });
    const second = first === "renew" ? competitor : "renew";
    const firstResult = outcome(run(first, hold.handle));
    await hold.done;
    const secondResult = outcome(run(second, database));
    try { await waitForLock(); } finally { hold.commit(); }
    const results = { [first]: await firstResult, [second]: await secondResult } as Record<string, { status: number; code?: string }>;
    expect(results[competitor].status).toBe(200);
    const childProof = { grantId: H, identityId: I, keyId: K, timestamp: HALF.toISOString(), signature: "" };
    const childRead = await outcome(executeMissionRequest(req(childToken, "/invitation", undefined, { proof: childProof }), at(HALF)));
    if (competitor === "close") {
      // Close revokes nothing: an earlier renewal stands but is closed; a later one is refused.
      if (first === "renew") { expect(results.renew.status).toBe(200); expect(childRead.status).toBe(200);
        expect((await admin`SELECT count(*)::int AS n FROM tools.collaboration_grants WHERE renewal_closed_at IS NULL`)[0].n).toBe(0); }
      else { expect(results.renew).toMatchObject({ status: 403, code: "collaboration_mission_renewal_unavailable" }); expect(childRead.status).toBe(401); }
      return;
    }
    expect(results.renew.status).toBe(first === "renew" ? 200 : 401);
    expect(childRead.status).toBe(401);
    if (competitor !== "mission") expect(await unrevokedMembers()).toBe(0);
  });
}

databaseTest("renew and revoke of the root race twenty times without a deadlock or a live member", async () => {
  for (let round = 0; round < 20; round++) {
    await resetMissions();
    const { token } = await renewableRoot();
    const results = await Promise.all([
      outcome(executeMissionRequest(renewReq(token, G, H, freshToken()), at(HALF))),
      outcome(revokeMissionGrant({ ...target, grantId: G }, at(HALF))),
    ]);
    for (const result of results) expect([200, 401]).toContain(result.status);
    expect(results[1].status).toBe(200);
    expect(await unrevokedMembers()).toBe(0);
  }
});

databaseTest("a renew proof that ages past five minutes while waiting on the root lock is refused", async () => {
  const { token } = await renewableRoot();
  const held = barrier(), release = barrier(); let clock = HALF;
  const transaction = locker.begin(async tx => { await tx`SELECT id FROM tools.collaboration_grants WHERE id = ${G} FOR UPDATE`; held.resolve(); await release.promise; });
  await held.promise;
  const pending = outcome(executeMissionRequest(renewReq(token, G, H, freshToken()), { database, now: () => clock }));
  try { await waitForLock(); clock = new Date(HALF.getTime() + 300_001); } finally { release.resolve(); }
  await transaction;
  expect((await pending).status).toBe(401);
  expect((await admin`SELECT count(*)::int AS n FROM tools.collaboration_grants`)[0].n).toBe(1);
});

databaseTest("explicit READ COMMITTED keeps the cascade complete even where sessions default to REPEATABLE READ", async () => {
  const { token } = await renewableRoot();
  const repeatable = postgres(DATABASE, { max: 1, prepare: false, connection: { application_name: "collaboration-mission-service-test" } });
  try {
    await repeatable.unsafe("SET default_transaction_isolation = 'repeatable read'");
    expect((await repeatable.begin(tx => tx`SHOW transaction_isolation`) as any)[0].transaction_isolation).toBe("repeatable read");
    const hold = delayed();
    const renewing = outcome(executeMissionRequest(renewReq(token, G, H, freshToken()), { database: hold.handle, now: HALF }));
    await hold.done;
    // The revoke's first statement takes its snapshot before the child commits, then waits on the root.
    const revoking = outcome(revokeMissionGrant({ ...target, grantId: G }, { database: drizzle(repeatable), now: HALF }));
    try { await waitForLock(); } finally { hold.commit(); }
    expect((await renewing).status).toBe(200);
    expect((await revoking).status).toBe(200);
    expect(await unrevokedMembers()).toBe(0);
  } finally { await repeatable.end({ timeout: 2 }); }
});

databaseTest("a 24-hour root renewed at every halfway over a 30-day window ends at the window with at most two live", async () => {
  const window = new Date(NOW.getTime() + 30 * 86_400_000);
  await createMission({ ...target, issuerApiKeyId: A, descriptor, expiresAt: window.toISOString() }, options());
  const root = await issueMissionGrant({ ...grantInput(), expiresAt: new Date(NOW.getTime() + 86_400_000).toISOString(), renewableUntil: window.toISOString() }, options()) as ServerIssuedMissionGrant;
  await executeMissionRequest(req(root.token, "/accept", { mission_digest: DIGEST }), options());
  let head = { id: G, token: root.token, issued: NOW, expires: new Date(NOW.getTime() + 86_400_000) }, rounds = 0;
  for (;;) {
    const time = new Date(head.issued.getTime() + Math.floor((head.expires.getTime() - head.issued.getTime()) / 2));
    const childToken = freshToken(), child = uid(100 + rounds);
    const result = await outcome(executeMissionRequest(renewReq(head.token, head.id, child, childToken, time), at(time)));
    if (result.status !== 200) { expect(result).toMatchObject({ status: 403, code: "collaboration_mission_renewal_unavailable" }); break; }
    expect(await membersAt(time)).toBeLessThanOrEqual(2);
    const grant = (result as { value: { data: { grant: { expires_at: string } } } }).value.data.grant;
    head = { id: child, token: childToken, issued: time, expires: new Date(grant.expires_at) };
    if (++rounds > 70) throw new Error("chain did not terminate");
  }
  expect(head.expires.toISOString()).toBe(window.toISOString());
  const rows = (await admin`SELECT count(*)::int AS n FROM tools.collaboration_grants`)[0].n;
  expect(rows).toBeLessThanOrEqual(62);
  expect(rows).toBeGreaterThan(50);
});

databaseTest("a revoking host whose clock is behind a member's issue time still ends it within the CHECKs", async () => {
  const { token } = await renewableRoot();
  await executeMissionRequest(renewReq(token, G, H, freshToken()), at(HALF));
  const skewed = new Date(HALF.getTime() - 60_000);
  await revokeMissionGrant({ ...target, grantId: G }, at(skewed));
  const rows = await admin`SELECT id, issued_at, revoked_at, renewal_closed_at FROM tools.collaboration_grants ORDER BY issued_at`;
  expect(rows.map(row => [row.id, row.revoked_at.toISOString(), row.renewal_closed_at.toISOString()]))
    .toEqual([[G, skewed.toISOString(), skewed.toISOString()], [H, HALF.toISOString(), HALF.toISOString()]]);
});

databaseTest("kicking an expired root the hub knows ends the live head it never saw", async () => {
  const { token } = await renewableRoot();
  const childToken = freshToken();
  await executeMissionRequest(renewReq(token, G, H, childToken), at(HALF));
  const later = new Date(END.getTime() + 60_000);
  const revoked = await revokeMissionGrant({ ...target, grantId: G }, at(later));
  expect(revoked).toMatchObject({ revoked_at: later.toISOString(), renewal: { renewed_to_grant_id: H } });
  const childProof = { grantId: H, identityId: I, keyId: K, timestamp: later.toISOString(), signature: "" };
  await expect(executeMissionRequest(req(childToken, "/context", undefined, { proof: childProof }), at(later))).rejects.toMatchObject({ status: 401 });
  expect(await unrevokedMembers()).toBe(0);
  // After a rollback, older code revokes one row only. A repeat revoke of that already
  // revoked root still reaches the live head it left behind.
  await resetMissions();
  const again = await renewableRoot();
  await executeMissionRequest(renewReq(again.token, G, H, childToken), at(HALF));
  await admin`UPDATE tools.collaboration_grants SET revoked_at = ${HALF} WHERE id = ${G}`;
  expect(await unrevokedMembers()).toBe(1);
  expect((await revokeMissionGrant({ ...target, grantId: G }, at(later))).revoked_at).toBe(HALF.toISOString());
  expect(await unrevokedMembers()).toBe(0);
});

databaseTest("a middle member renewing while the root is revoked cannot leave an escaped head", async () => {
  const { token } = await renewableRoot();
  const childToken = freshToken();
  await executeMissionRequest(renewReq(token, G, H, childToken), at(HALF));
  // H's halfway; H is a middle member, so only the root lock serializes it with the cascade.
  const time = new Date(HALF.getTime() + 1_800_000), hold = delayed();
  const renewing = outcome(executeMissionRequest(renewReq(childToken, H, E, freshToken(), time), { database: hold.handle, now: time }));
  await hold.done;
  const revoking = outcome(revokeMissionGrant({ ...target, grantId: G }, at(time)));
  try { await waitForLock(); } finally { hold.commit(); }
  expect((await renewing).status).toBe(200);
  expect((await revoking).status).toBe(200);
  expect((await admin`SELECT count(*)::int AS n FROM tools.collaboration_grants`)[0].n).toBe(3);
  expect(await unrevokedMembers()).toBe(0);
});
