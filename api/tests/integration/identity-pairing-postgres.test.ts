/** Pairing codes: real SQL on an explicit empty loopback test DB, including the
 * mission grant minted at pickup. Never falls back to DATABASE_URL or existing
 * application schemas. */
import { afterAll, beforeAll, beforeEach, expect, mock, test } from "bun:test";
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import * as ed from "@noble/ed25519";
import { drizzle } from "drizzle-orm/postgres-js";
import type { Sql } from "postgres";
import { Hono } from "hono";
import postgres from "../fixtures/verified-postgres";
import { canonicalIdentityEnrollmentBytes, enrollIdentity, ENROLLMENT_SIGNATURE_HEADER } from "../../src/services/identity/enrollment";
import { canonicalMissionRequestBytes } from "../../src/services/collaboration/proof";
import type { MissionRequest } from "../../src/services/collaboration/contracts";

const DATABASE = process.env.IDENTITY_PAIRING_TEST_DATABASE_URL?.trim() ?? "";
const databaseTest = DATABASE ? test : test.skip;
const uid = (n: number) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
const P = uid(1), I = uid(2), K = uid(3), A = uid(4), O = uid(5), OA = uid(6), M = uid(7), M2 = uid(8);
const NOW = new Date("2026-10-16T12:00:00.000Z"), ORIGIN = "https://api.agenttool.dev";
const MIN = 60_000, at = (ms: number) => new Date(NOW.getTime() + ms);
const SECRET = new Uint8Array(32).fill(3), OTHER_SECRET = new Uint8Array(32).fill(4);
const PRIVATE = new Uint8Array(32).fill(7), PUBLIC = Buffer.from(ed.getPublicKey(PRIVATE)).toString("base64");
const ATTACKER = new Uint8Array(32).fill(9), ATTACKER_PUBLIC = Buffer.from(ed.getPublicKey(ATTACKER)).toString("base64");
const PICKUP = Buffer.alloc(32, 5).toString("base64url"), OTHER_PICKUP = Buffer.alloc(32, 6).toString("base64url");
/** The device's own mission token (client token-new); only its hash ever leaves the device. */
const TOKEN = `atcm_${Buffer.alloc(32, 12).toString("base64url")}`, TOKEN_SHA256 = createHash("sha256").update(TOKEN).digest("hex");
const OTHER_TOKEN_SHA256 = createHash("sha256").update(`atcm_${Buffer.alloc(32, 13).toString("base64url")}`).digest("hex");
const descriptor = { format: "agenttool-collaboration-mission/v1", purpose: "Pairing test", resources: [], acceptance_criteria: ["Report evidence"], principalities: [] };
const GRANT = { mission_id: M, actions: ["mission.observe", "mission.read"], ttl_seconds: 3600 };
let sql: Sql, database: ReturnType<typeof drizzle>, owned = false, clockNow = NOW;
mock.module("../../src/db/client", () => ({
  db: new Proxy({}, { get: (_target, property) => Reflect.get(database as object, property) }),
}));
type Pairing = typeof import("../../src/services/identity/pairing");
type Store = typeof import("../../src/services/collaboration/store");
let pairing: Pairing, store: Store;
/** `null` means "no injected secret" (falls back to the environment). */
const opt = (secret: Uint8Array | null = SECRET) => ({ database: database as never, now: () => clockNow, secret: secret ?? undefined });
/** The device side: exactly the enroll-proof `join.sh sign` already produces. */
function proof(overrides: Record<string, unknown> = {}, projectId = P, key = PRIVATE) {
  const body = { format: "agenttool-identity-enrollment/v1", origin: ORIGIN, project_id: projectId, identity_id: I,
    signing_key_id: K, display_name: "Joining device", capabilities: [], public_key: Buffer.from(ed.getPublicKey(key)).toString("base64"),
    nonce: Buffer.alloc(32, 8).toString("base64url"), timestamp: clockNow.toISOString(), ...overrides };
  const bodyBytes = Buffer.from(JSON.stringify(body));
  const signature = Buffer.from(ed.sign(canonicalIdentityEnrollmentBytes({ origin: ORIGIN, projectId, bodyBytes }), key)).toString("base64url");
  return { origin: ORIGIN, bodyBytes, signature };
}
const FP = () => pairing.enrollmentFingerprint(PUBLIC);
const open = (projectId = P, apiKeyId = A) => pairing.createPairing({ projectId, apiKeyId }, opt());
const claim = (code: string, p = proof(), pickup = PICKUP) => pairing.claimPairing({ code, pickup, ...p }, opt());
const confirm = (pairingId: string, fingerprint: string, grant?: unknown, projectId = P, apiKeyId = A) =>
  pairing.confirmPairing({ projectId, apiKeyId, pairingId, fingerprint, origin: ORIGIN, grant }, opt());
/** `null` sends no token hash (an explicit `undefined` would fall back to the default). */
const pickup = (pairingId: string, secret = PICKUP, tokenSha256: string | null = TOKEN_SHA256) =>
  pairing.pickupPairing({ pairingId, pickup: secret, tokenSha256: tokenSha256 ?? undefined, origin: ORIGIN }, opt());
type Picked = { status: string; template: Record<string, string> };
/** What `invitation-assemble` does on the device: the template plus the locally held token. */
const assemble = (picked: unknown, token = TOKEN) => ({ ...(picked as Picked).template, token });
const view = (pairingId: string, projectId = P) => pairing.getPairing({ projectId, pairingId }, opt());
async function counts() {
  const [row] = await sql`SELECT (SELECT count(*)::int FROM identity.registration_proofs) AS proofs,
    (SELECT count(*)::int FROM identity.identities) AS identities, (SELECT count(*)::int FROM identity.identity_keys) AS keys`;
  return row;
}
const row = async (id: string) => (await sql`SELECT * FROM identity.pairings WHERE id = ${id}`)[0];
const grants = () => sql`SELECT * FROM tools.collaboration_grants ORDER BY issued_at, id`;
const wrongCode = (code: string) => (code[0] === "Z" ? "Y" : "Z") + code.slice(1);
/** Device uses the picked-up invitation with its own key, through the real mission service. */
function missionRequest(inv: Record<string, string>, path: string, body?: unknown, key = PRIVATE): MissionRequest {
  const request: MissionRequest = { token: inv.token, missionId: inv.mission_id, origin: ORIGIN, method: body === undefined ? "GET" : "POST",
    requestTarget: `/v1/collaboration/missions/${inv.mission_id}${path}`, bodyBytes: body === undefined ? new Uint8Array() : Buffer.from(JSON.stringify(body)),
    proof: { grantId: inv.grant_id, identityId: inv.identity_id, keyId: inv.signing_key_id, timestamp: clockNow.toISOString(), signature: "" } };
  request.proof = { ...request.proof, signature: Buffer.from(ed.sign(canonicalMissionRequestBytes(request), key)).toString("base64url") };
  return request;
}
/** Claim at +30 s, confirm at +8 min (past the 5-minute proof window). */
async function confirmedPairing(grant: unknown = GRANT) {
  const p = await open();
  clockNow = at(30_000); await claim(p.code, proof({ timestamp: NOW.toISOString() }));
  clockNow = at(8 * MIN); const confirmed = await confirm(p.pairing_id, FP(), grant);
  return { ...p, confirmed };
}

beforeAll(async () => {
  if (!DATABASE) return;
  const url = new URL(DATABASE);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.pathname !== "/agenttool_identity_pairing_test" || url.search || url.hash) throw new Error("pairing tests require the explicit disposable loopback database");
  sql = postgres(DATABASE, { max: 8, prepare: false, onnotice: () => {} });
  if ((await sql`SELECT 1 FROM pg_namespace WHERE nspname IN ('tools','identity')`).length) throw new Error("refusing existing application schemas");
  await sql.unsafe(`CREATE SCHEMA tools; CREATE SCHEMA identity;
    CREATE TABLE tools.projects (id uuid PRIMARY KEY);
    CREATE TABLE tools.api_keys (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES tools.projects(id),
      key_hash text UNIQUE, key_prefix text, name text, created_at timestamptz NOT NULL DEFAULT now(), last_used timestamptz,
      revoked_at timestamptz, expires_at timestamptz);
    CREATE TABLE identity.identities (id uuid PRIMARY KEY, did text NOT NULL UNIQUE, project_id uuid NOT NULL REFERENCES tools.projects(id),
      display_name text NOT NULL, capabilities text[] NOT NULL DEFAULT '{}', metadata jsonb DEFAULT '{}', status text NOT NULL, trust_score real NOT NULL,
      expression jsonb NOT NULL DEFAULT '{}', expression_visibility text NOT NULL DEFAULT 'private', parent_identity_id uuid, forked_at timestamptz,
      substrate_kind text NOT NULL DEFAULT 'llm', signing_scheme text NOT NULL DEFAULT 'single', modalities text[] NOT NULL DEFAULT '{text}',
      cardinality_kind text NOT NULL DEFAULT 'singular', persistence_kind text NOT NULL DEFAULT 'discrete_sessions', temporal_scale text NOT NULL DEFAULT 'second',
      embodiment_kind text NOT NULL DEFAULT 'disembodied', preferred_languages text[] NOT NULL DEFAULT '{en}', proxy_for_identity_id uuid, proxy_kind text NOT NULL DEFAULT 'none',
      pulse_kind text NOT NULL DEFAULT 'observed', wake_version bigint NOT NULL DEFAULT 0, wake_observation_count bigint NOT NULL DEFAULT 0,
      quiet_until timestamptz, quiet_reason text, poker_face_default boolean NOT NULL DEFAULT true, trust_capacity integer NOT NULL DEFAULT 5,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE identity.identity_keys (id uuid PRIMARY KEY, identity_id uuid NOT NULL REFERENCES identity.identities(id),
      public_key text NOT NULL, label text NOT NULL, active boolean NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz);`);
  owned = true;
  for (const file of ["20260718T120000_identity_authority_root.sql", "20260710T130000_identity_recovery_proofs.sql",
    "20260928T094318_collaboration_missions.sql", "20261016T220000_identity_pairings.sql"]) {
    await sql.unsafe(readFileSync(new URL(`../../migrations/${file}`, import.meta.url), "utf8").replace(/^\s*(BEGIN|COMMIT);\s*$/gm, ""));
  }
  database = drizzle(sql);
  pairing = await import("../../src/services/identity/pairing");
  store = await import("../../src/services/collaboration/store");
});
beforeEach(async () => {
  clockNow = NOW;
  if (!owned) return;
  await sql.unsafe(`DELETE FROM identity.pairings; DELETE FROM tools.collaboration_events; DELETE FROM tools.collaboration_grants; DELETE FROM tools.collaboration_missions;
    DELETE FROM identity.recovery_proofs; DELETE FROM identity.identity_keys; DELETE FROM identity.identities; DELETE FROM identity.registration_proofs;
    DELETE FROM tools.api_keys; DELETE FROM tools.projects;`);
  await sql`INSERT INTO tools.projects (id) VALUES (${P}),(${O})`;
  await sql`INSERT INTO tools.api_keys (id,project_id) VALUES (${A},${P}),(${OA},${O})`;
  const opts = { database: database as never, now: at(-MIN) };
  await store.createMission({ projectId: P, issuerApiKeyId: A, missionId: M, descriptor, expiresAt: at(2 * 86_400_000).toISOString() }, opts);
  await store.createMission({ projectId: P, issuerApiKeyId: A, missionId: M2, descriptor, expiresAt: at(30 * MIN).toISOString() }, opts);
});
afterAll(async () => {
  if (owned) await sql.unsafe("DROP SCHEMA identity CASCADE; DROP SCHEMA tools CASCADE;");
  await sql?.end({ timeout: 2 });
});

databaseTest("create returns a readable one-time code and stores only its keyed HMAC", async () => {
  const p = await open();
  expect(p.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  expect(p.expires_at).toBe(at(10 * MIN).toISOString());
  const stored = await row(p.pairing_id), normalized = p.code.replace("-", "");
  expect(JSON.stringify(stored)).not.toContain(normalized);
  expect(stored.code_hmac).toBe(createHmac("sha256", SECRET).update(`agenttool-pairing-code/v1\0${normalized}`).digest("hex"));
  expect(stored.code_hmac).not.toBe(createHash("sha256").update(`agenttool-pairing-code/v1\0${normalized}`).digest("hex"));
});

databaseTest("without PAIRING_CODE_SECRET pairing is off; a rotated secret invalidates open codes", async () => {
  const saved = process.env.PAIRING_CODE_SECRET; delete process.env.PAIRING_CODE_SECRET;
  try {
    await expect(pairing.createPairing({ projectId: P, apiKeyId: A }, opt(null))).rejects.toMatchObject({ code: "not_configured", status: 503 });
    await expect(pairing.claimPairing({ code: "ABCD-EFGH", pickup: PICKUP, ...proof() }, opt(null))).rejects.toMatchObject({ code: "not_configured" });
    await expect(pairing.claimPairing({ code: "nonsense", pickup: PICKUP, ...proof() }, opt(null))).rejects.toMatchObject({ code: "not_configured" });
    await expect(pairing.createPairing({ projectId: P, apiKeyId: A }, opt(new Uint8Array(31)))).rejects.toMatchObject({ code: "not_configured" });
  } finally { if (saved !== undefined) process.env.PAIRING_CODE_SECRET = saved; }
  const p = await open();
  await expect(pairing.claimPairing({ code: p.code, pickup: PICKUP, ...proof() }, opt(OTHER_SECRET))).rejects.toMatchObject({ code: "not_found" });
  expect((await claim(p.code)).status).toBe("claimed");
});

databaseTest("happy path without a grant: confirm past the proof window enrolls; the device's pickup reports enrolled", async () => {
  const p = await open(); const device = proof();
  clockNow = at(30_000);
  expect(await claim(p.code, device)).toEqual({ pairing_id: p.pairing_id, status: "claimed", expires_at: p.expires_at });
  expect(await pickup(p.pairing_id)).toEqual({ status: "pending", expires_at: p.expires_at });
  expect(await counts()).toEqual({ proofs: 0, identities: 0, keys: 0 });
  clockNow = at(8 * MIN);
  // Without the pairing seam this same proof is now stale.
  await expect(enrollIdentity({ projectId: P, issuerApiKeyId: A, ...device }, { database: database as never, now: clockNow })).rejects.toMatchObject({ status: 401 });
  const seen = await view(p.pairing_id);
  expect(seen).toMatchObject({ status: "claimed", identity_id: I, signing_key_id: K, display_name: "Joining device", handoff: false });
  expect(JSON.stringify(seen)).not.toContain(FP().replace(/-/g, "").slice(0, 8));
  expect(seen).not.toHaveProperty("fingerprint");
  // Typed as read aloud: lower case, spaces, O for 0, l for 1.
  const typed = FP().toLowerCase().replace(/-/g, " ").replace(/0/g, "o").replace(/1/g, "l");
  const enrolled = await confirm(p.pairing_id, typed);
  expect(enrolled).toMatchObject({ pairing_id: p.pairing_id, key: { kid: K, public_key: PUBLIC } });
  expect(enrolled).not.toHaveProperty("grant");
  expect(await counts()).toEqual({ proofs: 1, identities: 1, keys: 1 });
  expect(await row(p.pairing_id)).toMatchObject({ status: "confirmed", confirmed_by_api_key_id: A });
  expect(await pickup(p.pairing_id)).toEqual({ status: "enrolled", pairing_id: p.pairing_id, identity_id: I, signing_key_id: K });
  expect(await grants()).toHaveLength(0);
  await expect(confirm(p.pairing_id, FP())).rejects.toMatchObject({ code: "not_claimed", status: 409 });
  await expect(claim(p.code, proof(), OTHER_PICKUP)).rejects.toMatchObject({ code: "not_found", status: 404 });
  expect((await claim(p.code, device)).status).toBe("confirmed");
});

databaseTest("pickup issues the grant for the device's own token hash; pairing never handles the token", async () => {
  const { pairing_id, confirmed } = await confirmedPairing();
  expect(confirmed).toMatchObject({ grant: { ...GRANT, actions: ["mission.observe", "mission.read"] }, pickup_until: at(18 * MIN).toISOString() });
  expect(await grants()).toHaveLength(0);
  clockNow = at(9 * MIN);
  const got = await pickup(pairing_id) as Picked;
  expect(got.status).toBe("invited");
  expect(Object.keys(got.template).sort()).toEqual(["expires_at", "format", "grant_id", "identity_id", "mission_id", "origin", "public_key", "signing_key_id", "token_sha256"]);
  expect(got.template).toMatchObject({ format: "agenttool-mission-invitation-template/v1", origin: ORIGIN, mission_id: M, identity_id: I, signing_key_id: K,
    public_key: PUBLIC, expires_at: at(9 * MIN + 3600_000).toISOString(), token_sha256: TOKEN_SHA256 });
  expect(JSON.stringify(got)).not.toContain("atcm_");
  const [grant] = await grants();
  expect(grant).toMatchObject({ id: got.template.grant_id, identity_id: I, signing_key_id: K, issuing_api_key_id: A, revoked_at: null, token_hash: TOKEN_SHA256 });
  expect(await row(pairing_id)).toMatchObject({ grant_id: got.template.grant_id, claim_body: null, claim_signature: null, public_key: PUBLIC });
  // The device accepts with its own token and key through the real mission service; another key cannot.
  const inv = assemble(got), mission = await store.getMission({ projectId: P, missionId: M }, { database: database as never });
  await expect(store.executeMissionRequest(missionRequest(inv, "/accept", { mission_digest: mission.mission_digest }, ATTACKER), opt())).rejects.toMatchObject({ code: "collaboration_mission_invalid_credential" });
  expect((await store.executeMissionRequest(missionRequest(inv, "/accept", { mission_digest: mission.mission_digest }), opt())).created).toBe(true);
});

databaseTest("a lost pickup is re-delivered identically: one grant, never re-issued, never extended", async () => {
  const { pairing_id } = await confirmedPairing();
  const first = await pickup(pairing_id);
  clockNow = at(12 * MIN);
  const again = await pickup(pairing_id), third = await pickup(pairing_id);
  expect(again).toEqual(first); expect(third).toEqual(first);
  expect(await grants()).toHaveLength(1);
  expect((first as Picked).template.expires_at).toBe(at(8 * MIN + 3600_000).toISOString());
  expect((await store.executeMissionRequest(missionRequest(assemble(first), "/invitation"), opt())).created).toBe(false);
  // A different hash cannot take over the grant, and a missing hash is a malformed pickup.
  await expect(pickup(pairing_id, PICKUP, OTHER_TOKEN_SHA256)).rejects.toMatchObject({ code: "grant_unavailable", status: 409 });
  await expect(pickup(pairing_id, PICKUP, null)).rejects.toMatchObject({ code: "invalid_request", status: 400 });
  await expect(pickup(pairing_id, PICKUP, "AB".repeat(32))).rejects.toMatchObject({ code: "invalid_request" });
  expect(await grants()).toHaveLength(1);
});

databaseTest("an ordinary grant revocation is durable: pickup will not resurrect it", async () => {
  const { pairing_id } = await confirmedPairing();
  const got = await pickup(pairing_id) as Picked;
  await store.revokeMissionGrant({ projectId: P, missionId: M, grantId: got.template.grant_id }, { database: database as never, now: clockNow });
  await expect(pickup(pairing_id)).rejects.toMatchObject({ code: "grant_unavailable", status: 409 });
  await expect(pickup(pairing_id, PICKUP, OTHER_TOKEN_SHA256)).rejects.toMatchObject({ code: "grant_unavailable" });
  const all = await grants();
  expect(all).toHaveLength(1); expect(all[0].revoked_at).not.toBeNull();
});

databaseTest("a token hash already bound to another grant is refused without enrolling a second grant", async () => {
  const { pairing_id } = await confirmedPairing();
  // Another grant (issued by the administrator directly) already holds the device's hash.
  await store.issueMissionGrant({ projectId: P, missionId: M, issuerApiKeyId: A, grantId: uid(41), identityId: I, signingKeyId: K, origin: ORIGIN,
    actions: ["mission.read"], expiresAt: at(60 * MIN).toISOString(), tokenSha256: TOKEN_SHA256 }, { database: database as never, now: clockNow });
  await expect(pickup(pairing_id)).rejects.toMatchObject({ code: "grant_unavailable", status: 409 });
  expect(await row(pairing_id)).toMatchObject({ grant_id: null });
  expect((await pickup(pairing_id, PICKUP, OTHER_TOKEN_SHA256) as Picked).template.token_sha256).toBe(OTHER_TOKEN_SHA256);
});

databaseTest("pickup refuses wrong secrets, unknown ids and the closed window uniformly", async () => {
  const { pairing_id } = await confirmedPairing();
  for (const attempt of [() => pickup(pairing_id, OTHER_PICKUP), () => pickup(pairing_id, "short"), () => pickup(uid(99)), () => pickup("not-a-uuid")]) {
    await expect(attempt()).rejects.toMatchObject({ code: "not_found", status: 404 });
  }
  clockNow = at(18 * MIN);
  await expect(pickup(pairing_id)).rejects.toMatchObject({ code: "not_found" });
  expect(await grants()).toHaveLength(0);
});

databaseTest("grant expiry is clipped to the mission, and the issuer is judged live at pickup", async () => {
  const short = await confirmedPairing({ ...GRANT, mission_id: M2, ttl_seconds: 86_400 });
  const inv = (await pickup(short.pairing_id) as Picked).template;
  expect(inv.expires_at).toBe(at(30 * MIN).toISOString());
  await sql.unsafe("DELETE FROM identity.pairings; DELETE FROM tools.collaboration_grants; DELETE FROM identity.identity_keys; DELETE FROM identity.identities; DELETE FROM identity.registration_proofs;");
  clockNow = NOW;
  const later = await confirmedPairing();
  await sql`UPDATE tools.api_keys SET revoked_at = ${clockNow.toISOString()} WHERE id = ${A}`;
  await expect(pickup(later.pairing_id)).rejects.toMatchObject({ code: "grant_unavailable", status: 409 });
  expect(await row(later.pairing_id)).toMatchObject({ grant_id: null });
  expect(await grants()).toHaveLength(0);
});

databaseTest("grant expiry is also clamped to the confirming key's own expiry", async () => {
  await sql`UPDATE tools.api_keys SET expires_at = ${at(50 * MIN).toISOString()} WHERE id = ${A}`;
  const { pairing_id } = await confirmedPairing({ ...GRANT, ttl_seconds: 86_400 });
  const inv = (await pickup(pairing_id) as Picked).template;
  expect(inv.expires_at).toBe(at(50 * MIN).toISOString());
});

databaseTest("confirm refuses bad grant specs and unusable missions before enrolling anything", async () => {
  const p = await open(); await claim(p.code);
  for (const grant of [{ ...GRANT, actions: [] }, { ...GRANT, actions: ["mission.admin"] }, { ...GRANT, actions: ["mission.read", "mission.read"] },
    { ...GRANT, ttl_seconds: 59 }, { ...GRANT, ttl_seconds: 86_401 }, { ...GRANT, ttl_seconds: 1.5 }, { ...GRANT, mission_id: "x" },
    { ...GRANT, extra: true }, [GRANT], "grant", { ...GRANT, mission_id: uid(98) }]) {
    await expect(confirm(p.pairing_id, FP(), grant)).rejects.toMatchObject({ code: "invalid_request", status: 400 });
  }
  await store.revokeMission({ projectId: P, missionId: M }, { database: database as never, now: clockNow });
  await expect(confirm(p.pairing_id, FP(), GRANT)).rejects.toMatchObject({ code: "invalid_request" });
  expect(await counts()).toEqual({ proofs: 0, identities: 0, keys: 0 });
  expect((await row(p.pairing_id)).status).toBe("claimed");
});

databaseTest("concurrent claims of one code: exactly one wins", async () => {
  const p = await open();
  const results = await Promise.allSettled([claim(p.code), claim(p.code, proof({}, P, ATTACKER), OTHER_PICKUP)]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect((results.find(r => r.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ code: "not_found" });
  expect((await row(p.pairing_id)).status).toBe("claimed");
});

databaseTest("an intercepted code claimed by another key is caught when the admin types the device's fingerprint", async () => {
  const p = await open();
  await claim(p.code, proof({}, P, ATTACKER), OTHER_PICKUP);
  await expect(confirm(p.pairing_id, FP())).rejects.toMatchObject({ code: "fingerprint_mismatch", status: 409 });
  await expect(confirm(p.pairing_id, "AAAA")).rejects.toMatchObject({ code: "fingerprint_mismatch" });
  expect(await counts()).toEqual({ proofs: 0, identities: 0, keys: 0 });
  expect(await pairing.cancelPairing({ projectId: P, pairingId: p.pairing_id }, opt()))
    .toEqual({ pairing_id: p.pairing_id, status: "cancelled", enrolled: false, revoked_grant_id: null });
  expect((await row(p.pairing_id)).fingerprint).toBe(pairing.enrollmentFingerprint(ATTACKER_PUBLIC));
  await expect(confirm(p.pairing_id, pairing.enrollmentFingerprint(ATTACKER_PUBLIC))).rejects.toMatchObject({ code: "not_claimed" });
  await expect(pickup(p.pairing_id, OTHER_PICKUP)).rejects.toMatchObject({ code: "not_found" });
});

databaseTest("claimed but unconfirmed pairing dies with the pairing TTL", async () => {
  const p = await open(); await claim(p.code);
  clockNow = at(10 * MIN);
  expect((await view(p.pairing_id)).status).toBe("expired");
  await expect(confirm(p.pairing_id, FP())).rejects.toMatchObject({ code: "not_claimed" });
  await expect(pickup(p.pairing_id)).rejects.toMatchObject({ code: "not_found" });
  expect(await counts()).toEqual({ proofs: 0, identities: 0, keys: 0 });
});

databaseTest("a stale proof is refused like an unknown code and leaves the pairing untouched; codes expire at 10 minutes", async () => {
  const p = await open();
  clockNow = at(6 * MIN);
  await expect(claim(p.code, proof({ timestamp: NOW.toISOString() }))).rejects.toMatchObject({ code: "not_found", status: 404 });
  expect(await row(p.pairing_id)).toMatchObject({ status: "open", claimed_at: null });
  clockNow = at(10 * MIN);
  await expect(claim(p.code)).rejects.toMatchObject({ code: "not_found", status: 404 });
});

databaseTest("no oracle: one junk proof gets the same refusal for missing, open, claimed, expired and cancelled codes", async () => {
  const live = await open(), taken = await open(), gone = await open(), dropped = await open();
  await claim(taken.code, proof(), OTHER_PICKUP);
  await pairing.cancelPairing({ projectId: P, pairingId: dropped.pairing_id }, opt());
  const junk = { origin: ORIGIN, bodyBytes: Buffer.from(JSON.stringify({ project_id: P })), signature: "x" };
  const before = JSON.stringify(await sql`SELECT * FROM identity.pairings ORDER BY id`);
  const refusals = [];
  for (const code of [wrongCode(live.code), live.code, taken.code, dropped.code, "bad"]) {
    refusals.push(await pairing.claimPairing({ code, pickup: PICKUP, ...junk }, opt()).catch(e => e));
  }
  clockNow = at(10 * MIN);
  refusals.push(await pairing.claimPairing({ code: gone.code, pickup: PICKUP, ...junk }, opt()).catch(e => e));
  for (const r of refusals) expect(r).toMatchObject({ code: "not_found", status: 404, message: "identity_pairing_not_found" });
  expect(JSON.stringify(await sql`SELECT * FROM identity.pairings ORDER BY id`)).toBe(before);
});

databaseTest("a lost claim response is recoverable with the same pickup secret, and only with it", async () => {
  const p = await open();
  clockNow = at(30_000); const device = proof();
  const first = await claim(p.code, device);
  clockNow = at(7 * MIN); // past the proof window: the retry is matched, not re-verified
  expect(await claim(p.code, device)).toEqual(first);
  expect(await claim(p.code, proof({ nonce: Buffer.alloc(32, 1).toString("base64url") }))).toEqual(first);
  await expect(claim(p.code, device, OTHER_PICKUP)).rejects.toMatchObject({ code: "not_found" });
  await confirm(p.pairing_id, FP());
  expect(await claim(p.code, device)).toEqual({ ...first, status: "confirmed" });
  clockNow = at(17 * MIN + 1);
  await expect(claim(p.code, device)).rejects.toMatchObject({ code: "not_found" });
});

databaseTest("wrong codes never kill anyone's pairings (no per-project lever)", async () => {
  const p = await open();
  for (let i = 0; i < 30; i++) await expect(claim(wrongCode(p.code))).rejects.toMatchObject({ code: "not_found" });
  await expect(claim("not a code")).rejects.toMatchObject({ code: "not_found" });
  expect(await row(p.pairing_id)).toMatchObject({ status: "open", claimed_at: null });
  expect((await claim(p.code)).status).toBe("claimed");
});

databaseTest("claim requires a well-formed pickup secret before touching any pairing", async () => {
  const p = await open();
  for (const bad of ["", "short", PICKUP + "A", PICKUP.slice(0, 42) + "="]) {
    await expect(claim(p.code, proof(), bad)).rejects.toMatchObject({ code: "invalid_request", status: 400 });
  }
  expect((await row(p.pairing_id)).status).toBe("open");
});

databaseTest("typed codes forgive case, spaces, and I/L/O look-alikes", async () => {
  for (let i = 0; i < 12; i++) {
    const code = pairing.newPairingCode();
    const typed = code.toLowerCase().replace("-", " ").replace(/1/g, "l").replace(/0/g, "o");
    expect(pairing.normalizePairingCode(typed)).toBe(code.replace("-", ""));
  }
  expect(pairing.normalizePairingCode("ABCD-EFGU")).toBeNull();
  expect(pairing.normalizePairingCode("ABCD-EFG")).toBeNull();
  const p = await open();
  expect((await claim(` ${p.code.toLowerCase()} `)).status).toBe("claimed");
});

databaseTest("a proof signed for another project is refused at claim", async () => {
  const p = await open();
  await expect(claim(p.code, proof({}, O))).rejects.toMatchObject({ code: "not_found", status: 404 });
  expect((await row(p.pairing_id)).status).toBe("open");
});

databaseTest("the administrator key is judged at confirm time, not claim time", async () => {
  const p = await open(); await claim(p.code);
  clockNow = at(2 * MIN);
  // Expiry is the clock-sensitive check: the key was valid at claim, not at confirm.
  await sql`UPDATE tools.api_keys SET expires_at = ${at(MIN).toISOString()} WHERE id = ${A}`;
  await expect(confirm(p.pairing_id, FP())).rejects.toMatchObject({ code: "administrator_invalid", status: 401 });
  await sql`UPDATE tools.api_keys SET expires_at = NULL, revoked_at = ${at(MIN).toISOString()} WHERE id = ${A}`;
  await expect(confirm(p.pairing_id, FP())).rejects.toMatchObject({ code: "administrator_invalid", status: 401 });
  expect(await counts()).toEqual({ proofs: 0, identities: 0, keys: 0 });
  expect((await row(p.pairing_id)).status).toBe("claimed");
  // Another project's administrator cannot even see it.
  await expect(confirm(p.pairing_id, FP(), undefined, O, OA)).rejects.toMatchObject({ code: "not_found" });
  await expect(view(p.pairing_id, O)).rejects.toMatchObject({ code: "not_found" });
});

databaseTest("one proof held by two pairings enrolls at most once", async () => {
  const first = await open(), second = await open(); const device = proof();
  await claim(first.code, device); await claim(second.code, device, OTHER_PICKUP);
  await confirm(first.pairing_id, FP());
  await expect(confirm(second.pairing_id, FP())).rejects.toMatchObject({ status: 409 });
  expect(await counts()).toEqual({ proofs: 1, identities: 1, keys: 1 });
  expect((await row(second.pairing_id)).status).toBe("claimed");
});

databaseTest("cancel closes open and claimed pairings, stops pickup on confirmed ones and revokes the minted grant", async () => {
  const a = await open(), b = await open(); await claim(b.code, proof(), OTHER_PICKUP);
  for (const p of [a, b]) {
    expect(await pairing.cancelPairing({ projectId: P, pairingId: p.pairing_id }, opt())).toMatchObject({ status: "cancelled", enrolled: false });
    await expect(pairing.cancelPairing({ projectId: P, pairingId: p.pairing_id }, opt())).rejects.toMatchObject({ code: "not_found" });
  }
  await expect(claim(a.code)).rejects.toMatchObject({ code: "not_found" });
  await sql`DELETE FROM identity.pairings`;
  clockNow = NOW;
  const c = await confirmedPairing();
  const inv = assemble(await pickup(c.pairing_id));
  expect(await pairing.cancelPairing({ projectId: P, pairingId: c.pairing_id }, opt()))
    .toEqual({ pairing_id: c.pairing_id, status: "cancelled", enrolled: true, revoked_grant_id: inv.grant_id });
  await expect(store.executeMissionRequest(missionRequest(inv, "/invitation"), opt())).rejects.toMatchObject({ code: "collaboration_mission_invalid_credential" });
  await expect(pickup(c.pairing_id)).rejects.toMatchObject({ code: "not_found" });
  expect(await counts()).toEqual({ proofs: 1, identities: 1, keys: 1 });
});

databaseTest("at most ten active pairings per project; expired ones free the slot; old rows are purged", async () => {
  for (let i = 0; i < 10; i++) await open();
  await expect(open()).rejects.toMatchObject({ code: "limit_reached", status: 409 });
  expect((await open(O, OA)).code).toBeTruthy();
  clockNow = at(10 * MIN);
  const fresh = await open();
  expect((await sql`SELECT count(*)::int AS n FROM identity.pairings WHERE project_id = ${P}`)[0].n).toBe(11);
  // Rows that expired more than 7 days ago (the first ten, and project O's) go on the next create.
  clockNow = at(10 * MIN + 7 * 86_400_000 + 1);
  const newest = await open();
  const left = await sql`SELECT id FROM identity.pairings ORDER BY created_at`;
  expect(left.map(r => r.id)).toEqual([fresh.pairing_id, newest.pairing_id]);
});

databaseTest("the cap holds under concurrent creates", async () => {
  const results = await Promise.allSettled(Array.from({ length: 14 }, () => open()));
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(10);
  for (const r of results.filter(r => r.status === "rejected")) expect((r as PromiseRejectedResult).reason).toMatchObject({ code: "limit_reached" });
});

databaseTest("raw claims are erased on cancel, and the purge is bounded per create", async () => {
  const p = await open(); await claim(p.code);
  expect((await row(p.pairing_id)).claim_body).not.toBeNull();
  await pairing.cancelPairing({ projectId: P, pairingId: p.pairing_id }, opt());
  expect(await row(p.pairing_id)).toMatchObject({ claim_body: null, claim_signature: null, status: "cancelled" });
  await sql`DELETE FROM identity.pairings`;
  await sql`INSERT INTO identity.pairings (project_id, created_by_api_key_id, code_hmac, created_at, expires_at)
    SELECT ${P}, ${A}, md5(g::text) || md5((g + 1000)::text), ${at(-30 * 86_400_000).toISOString()}::timestamptz, ${at(-29 * 86_400_000).toISOString()}::timestamptz
    FROM generate_series(1, 150) g`;
  await open();
  expect((await sql`SELECT count(*)::int AS n FROM identity.pairings`)[0].n).toBe(51);
  await open();
  expect((await sql`SELECT count(*)::int AS n FROM identity.pairings`)[0].n).toBe(2);
});

databaseTest("handoff: public JSON relayed verbatim to the device, bounded and object-only", async () => {
  const pins = { format: "agenttool-mission-pins/v2", note: "public pins only", mission_id: M, peer: { label: "air-m2", identity_id: I } };
  const p = await open(); await claim(p.code);
  for (const bad of [[pins], "pins", 7, { blob: "x".repeat(8200) }]) {
    await expect(pairing.confirmPairing({ projectId: P, apiKeyId: A, pairingId: p.pairing_id, fingerprint: FP(), origin: ORIGIN, handoff: bad }, opt()))
      .rejects.toMatchObject({ code: "invalid_request" });
  }
  await pairing.confirmPairing({ projectId: P, apiKeyId: A, pairingId: p.pairing_id, fingerprint: FP(), origin: ORIGIN, handoff: pins, grant: GRANT }, opt());
  expect((await view(p.pairing_id)).handoff).toBe(true);
  expect(await pickup(p.pairing_id)).toMatchObject({ status: "invited", handoff: pins });
});

databaseTest("PAIRING_CODE_SECRET must be canonical base64 of at least 32 bytes", async () => {
  const saved = process.env.PAIRING_CODE_SECRET;
  try {
    const good = Buffer.alloc(32, 1).toString("base64");
    for (const bad of ["", Buffer.alloc(31, 1).toString("base64"), "!!" + good, "not base64 at all, but long enough to be 32+ chars", good + "==", good.replace(/=+$/, "") + "=AB"]) {
      process.env.PAIRING_CODE_SECRET = bad;
      await expect(pairing.createPairing({ projectId: P, apiKeyId: A }, opt(null))).rejects.toMatchObject({ code: "not_configured" });
    }
    process.env.PAIRING_CODE_SECRET = good.replace(/=+$/, "");
    expect((await pairing.createPairing({ projectId: P, apiKeyId: A }, opt(null))).code).toBeTruthy();
    process.env.PAIRING_CODE_SECRET = Buffer.from(SECRET).toString("base64");
    const p = await pairing.createPairing({ projectId: P, apiKeyId: A }, opt(null));
    expect((await claim(p.code)).status).toBe("claimed");
  } finally { if (saved === undefined) delete process.env.PAIRING_CODE_SECRET; else process.env.PAIRING_CODE_SECRET = saved; }
});

/** Holds a row lock on another connection (the pairing row by default) while `start` runs into it. */
async function acrossLock(pairingId: string, start: () => Promise<unknown>, whileWaiting: (holder: Sql) => unknown,
  lock: (h: Sql) => Promise<unknown> = h => h`SELECT 1 FROM identity.pairings WHERE id = ${pairingId} FOR UPDATE`) {
  const holder = await sql.reserve();
  try {
    await holder`BEGIN`;
    await lock(holder as unknown as Sql);
    const pending = start().then(v => ({ ok: v }), e => ({ error: e }));
    for (let i = 0; ; i++) {
      if ((await sql`SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`).length) break;
      if (i > 300) throw new Error("request never reached the row lock");
      await Bun.sleep(10);
    }
    await whileWaiting(holder as unknown as Sql);
    await holder`COMMIT`;
    return await pending;
  } finally {
    // Never return a connection with an open transaction (it would block teardown).
    await holder`ROLLBACK`.catch(() => {});
    holder.release();
  }
}

databaseTest("deadlines are judged after the row lock: a confirm that waits past expiry is refused", async () => {
  const p = await open(); await claim(p.code);
  clockNow = at(9 * MIN);
  const outcome = await acrossLock(p.pairing_id, () => confirm(p.pairing_id, FP()), () => { clockNow = at(10 * MIN); });
  expect(outcome).toMatchObject({ error: { code: "not_claimed" } });
  expect(await counts()).toEqual({ proofs: 0, identities: 0, keys: 0 });
});

databaseTest("deadlines are judged after the row lock: a first pickup that waits past the window is refused", async () => {
  const { pairing_id } = await confirmedPairing();
  clockNow = at(17 * MIN);
  const outcome = await acrossLock(pairing_id, () => pickup(pairing_id), () => { clockNow = at(18 * MIN); });
  expect(outcome).toMatchObject({ error: { code: "not_found" } });
  expect(await grants()).toHaveLength(0);
});

databaseTest("deadlines hold after later lock waits too: a confirm stuck behind the admin key lock past expiry is refused", async () => {
  const p = await open(); await claim(p.code);
  clockNow = at(9 * MIN);
  const outcome = await acrossLock(p.pairing_id, () => confirm(p.pairing_id, FP()), () => { clockNow = at(10 * MIN); },
    h => h`SELECT 1 FROM tools.api_keys WHERE id = ${A} FOR UPDATE`);
  expect(outcome).toMatchObject({ error: { code: "not_claimed" } });
  expect(await counts()).toEqual({ proofs: 0, identities: 0, keys: 0 });
  expect((await row(p.pairing_id)).status).toBe("claimed");
});

databaseTest("deadlines hold after later lock waits too: a first pickup stuck behind the mission lock past the window leaves no grant", async () => {
  const { pairing_id } = await confirmedPairing();
  clockNow = at(17 * MIN);
  const outcome = await acrossLock(pairing_id, () => pickup(pairing_id), () => { clockNow = at(18 * MIN); },
    h => h`SELECT 1 FROM tools.collaboration_missions WHERE id = ${M} FOR UPDATE`);
  expect(outcome).toMatchObject({ error: { code: "not_found" } });
  expect(await grants()).toHaveLength(0);
  expect(await row(pairing_id)).toMatchObject({ grant_id: null });
});

databaseTest("re-delivery waits for a revocation in progress and then refuses (judged under locks, not a stale read)", async () => {
  const { pairing_id } = await confirmedPairing();
  const got = await pickup(pairing_id) as Picked;
  const outcome = await acrossLock(pairing_id, () => pickup(pairing_id), h => h`UPDATE tools.collaboration_grants SET revoked_at = ${clockNow.toISOString()} WHERE id = ${got.template.grant_id}`,
    h => h`SELECT 1 FROM tools.collaboration_grants WHERE id = ${got.template.grant_id} FOR UPDATE`);
  expect(outcome).toMatchObject({ error: { code: "grant_unavailable" } });
});

databaseTest("re-delivery that waits on an authority lock past the pickup window is refused", async () => {
  const { pairing_id } = await confirmedPairing();
  const got = await pickup(pairing_id) as Picked;
  clockNow = at(17 * MIN);
  const outcome = await acrossLock(pairing_id, () => pickup(pairing_id), () => { clockNow = at(18 * MIN); },
    h => h`SELECT 1 FROM tools.collaboration_grants WHERE id = ${got.template.grant_id} FOR UPDATE`);
  expect(outcome).toMatchObject({ error: { code: "not_found" } });
});

databaseTest("re-delivery refuses once the issuer, the mission, or the device key is gone", async () => {
  const revoke = [
    () => sql`UPDATE tools.api_keys SET revoked_at = ${clockNow.toISOString()} WHERE id = ${A}`,
    () => store.revokeMission({ projectId: P, missionId: M }, { database: database as never, now: clockNow }),
    () => sql`UPDATE identity.identity_keys SET revoked_at = ${clockNow.toISOString()}, active = false WHERE id = ${K}`,
  ];
  for (const gone of revoke) {
    await sql.unsafe("DELETE FROM identity.pairings; DELETE FROM tools.collaboration_grants; DELETE FROM identity.identity_keys; DELETE FROM identity.identities; DELETE FROM identity.registration_proofs; UPDATE tools.api_keys SET revoked_at = NULL; UPDATE tools.collaboration_missions SET revoked_at = NULL;");
    clockNow = NOW;
    const { pairing_id } = await confirmedPairing();
    expect((await pickup(pairing_id) as Picked).status).toBe("invited");
    await gone();
    await expect(pickup(pairing_id)).rejects.toMatchObject({ code: "grant_unavailable", status: 409 });
    expect(await grants()).toHaveLength(1);
  }
});

databaseTest("the early boundary keeps refusals private before auth runs", async () => {
  const { identityPairingCacheBoundary, isPairingPath } = await import("../../src/routes/identity/pairings");
  const app = new Hono().use("*", identityPairingCacheBoundary())
    .use("*", async c => { c.header("ETag", '"x"'); c.header("Cache-Control", "public, max-age=60"); return c.json({ error: "unauthorized" }, 401); });
  for (const path of ["/v1/identities/pairings", "/v1/identities/pairings/x/confirm", "/v1/pairing/claim", "/v1/pairing/pickup"]) {
    const res = await app.request(path, { method: "POST" });
    expect(res.status).toBe(401); expect(res.headers.get("cache-control")).toBe("private, no-store"); expect(res.headers.get("etag")).toBeNull();
  }
  const other = await app.request("/v1/identities/enroll", { method: "POST" });
  expect(other.headers.get("cache-control")).toBe("public, max-age=60");
  for (const path of ["/v1/pairing", "/v1/%70airing/claim", "/v1/identities//pairings"]) expect(isPairingPath(path)).toBe(true);
  for (const path of ["/v1/pairings", "/v1/pairingx/claim", "/v1/identities/enroll"]) expect(isPairingPath(path)).toBe(false);
});

databaseTest("HTTP: the device claims and picks up with no bearer; the administrator confirms through the authenticated router", async () => {
  const { createPairingDeviceRouter, PAIRING_CODE_HEADER, PAIRING_PICKUP_HEADER } = await import("../../src/routes/pairing-device");
  const { createPairingsRouter, isIdentityPairingPath } = await import("../../src/routes/identity/pairings");
  const saved = process.env.PAIRING_CODE_SECRET; process.env.PAIRING_CODE_SECRET = Buffer.from(SECRET).toString("base64");
  try {
    // Real clock here: the routes use the service defaults.
    const MH = uid(20), live = Date.now();
    await store.createMission({ projectId: P, issuerApiKeyId: A, missionId: MH, descriptor, expiresAt: new Date(live + 86_400_000).toISOString() },
      { database: database as never, now: new Date(live - MIN) });
    let allowed = true;
    const pub = new Hono().route("/v1/pairing", createPairingDeviceRouter({ origin: () => ORIGIN,
      rateLimit: async () => (allowed ? { allowed: true, remaining: 1, resetAt: 0 } : { allowed: false, retryAfterSec: 42 }) as never }));
    const admin = new Hono<import("../../src/auth/middleware").ProjectContext>()
      .use("*", async (c, next) => { c.set("project", { id: P } as never); c.set("apiKeyId", A); await next(); })
      .route("/v1/identities/pairings", createPairingsRouter({ origin: () => ORIGIN }));
    const json = { "Content-Type": "application/json" };
    const created = await admin.request("/v1/identities/pairings", { method: "POST" });
    expect(created.status).toBe(201); expect(created.headers.get("cache-control")).toBe("private, no-store");
    const { pairing_id, code } = await created.json() as { pairing_id: string; code: string };
    const device = proof({ timestamp: new Date().toISOString() });
    const send = (headers: Record<string, string>) => pub.request("/v1/pairing/claim", { method: "POST", body: device.bodyBytes, headers });
    const good = { ...json, [ENROLLMENT_SIGNATURE_HEADER]: device.signature, [PAIRING_CODE_HEADER]: code, [PAIRING_PICKUP_HEADER]: PICKUP };
    expect((await send({ ...good, "Content-Type": "text/plain" })).status).toBe(415);
    expect((await send({ ...good, [PAIRING_PICKUP_HEADER]: "" })).status).toBe(400);
    const missing = await send({ ...good, [PAIRING_CODE_HEADER]: "" });
    expect(missing.status).toBe(404); expect(JSON.stringify(await missing.json())).toContain("identity_pairing_not_found");
    allowed = false;
    const limited = await send(good);
    expect(limited.status).toBe(429); expect(limited.headers.get("retry-after")).toBe("42");
    allowed = true;
    const claimed = await send(good);
    expect(claimed.status).toBe(202); expect(claimed.headers.get("cache-control")).toBe("private, no-store");
    expect(await claimed.json()).not.toHaveProperty("fingerprint");
    const poll = () => pub.request("/v1/pairing/pickup", { method: "POST", body: JSON.stringify({ pairing_id, token_sha256: TOKEN_SHA256 }), headers: { ...json, [PAIRING_PICKUP_HEADER]: PICKUP } });
    expect((await poll()).status).toBe(202);
    expect((await pub.request("/v1/pairing/pickup", { method: "POST", body: "{", headers: { ...json, [PAIRING_PICKUP_HEADER]: PICKUP } })).status).toBe(404);
    const shown = await (await admin.request(`/v1/identities/pairings/${pairing_id}`)).json() as Record<string, unknown>;
    expect(shown).toMatchObject({ status: "claimed", identity_id: I }); expect(shown).not.toHaveProperty("fingerprint");
    const confirmAs = (fingerprint: string) => admin.request(`/v1/identities/pairings/${pairing_id}/confirm`, { method: "POST",
      body: JSON.stringify({ fingerprint, grant: { ...GRANT, mission_id: MH } }), headers: json });
    const bad = await confirmAs("AAAA-AAAA-AAAA-AAAA");
    expect(bad.status).toBe(409); expect(JSON.stringify(await bad.json())).toContain("identity_pairing_fingerprint_mismatch");
    const ok = await confirmAs(FP());
    expect(ok.status).toBe(201);
    expect(await ok.json()).toMatchObject({ pairing_id, key: { kid: K, public_key: PUBLIC }, grant: { mission_id: MH } });
    const picked = await poll();
    expect(picked.status).toBe(200); expect(picked.headers.get("cache-control")).toBe("private, no-store");
    const body = await picked.json() as Record<string, unknown>;
    expect(body).toMatchObject({ status: "invited", template: { format: "agenttool-mission-invitation-template/v1", mission_id: MH, identity_id: I, token_sha256: TOKEN_SHA256 } });
    expect(JSON.stringify(body)).not.toContain("atcm_");
    for (const path of ["/v1/identities/pairings", "/v1/identities/pairings/x/confirm", "/v1/identities/%70airings", "/v1/identities//pairings"]) expect(isIdentityPairingPath(path)).toBe(true);
    for (const path of ["/v1/identities/enroll", "/v1/identities/pairingsx", "/v1/pairing/claim"]) expect(isIdentityPairingPath(path)).toBe(false);
  } finally { if (saved === undefined) delete process.env.PAIRING_CODE_SECRET; else process.env.PAIRING_CODE_SECRET = saved; }
});
