/** Real migration/service races, only against an explicitly selected empty loopback fixture DB.
 * Doctrine: docs/COLLABORATION-MISSIONS.md. Never falls back to application DATABASE_URL.
 */
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as ed from "@noble/ed25519";
import { drizzle } from "drizzle-orm/postgres-js";
import type { Sql } from "postgres";
import postgres from "../fixtures/verified-postgres";
import { createMission, executeMissionRequest, getMission, getMissionGrant, issueMissionGrant, revokeMission, revokeMissionGrant } from "../../src/services/collaboration/store";
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
  const token = (issued.find(r => r.status === "fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<typeof issueMissionGrant>>>).value.token;
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
