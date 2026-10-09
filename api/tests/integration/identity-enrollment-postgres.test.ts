/** Actual SQL uniqueness and rollback; only an explicit empty loopback test DB.
 * Never falls back to DATABASE_URL or existing application schemas. */
import { afterAll, beforeAll, beforeEach, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as ed from "@noble/ed25519";
import { drizzle } from "drizzle-orm/postgres-js";
import type { Sql } from "postgres";
import postgres from "../fixtures/verified-postgres";
import { Hono } from "hono";
import { canonicalIdentityEnrollmentBytes, enrollIdentity } from "../../src/services/identity/enrollment";
import { canonicalDiscoveryBytes, canonicalRecoverBytes } from "../../src/services/identity/crypto";

const DATABASE = process.env.IDENTITY_ENROLLMENT_TEST_DATABASE_URL?.trim() ?? "";
const databaseTest = DATABASE ? test : test.skip;
const uid = (n: number) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
const P = uid(1), I = uid(2), K = uid(3), A = uid(4), O = uid(5);
const NOW = new Date("2026-09-29T12:00:00.000Z"), ORIGIN = "https://api.agenttool.dev";
const PRIVATE = new Uint8Array(32).fill(7), PUBLIC = Buffer.from(ed.getPublicKey(PRIVATE)).toString("base64");
let sql: Sql, database: ReturnType<typeof drizzle>, owned = false;
// Routes and services below read the shared db client; point that seam at the
// same disposable database so their real SQL runs here.
mock.module("../../src/db/client", () => ({
  db: new Proxy({}, { get: (_target, property) => Reflect.get(database as object, property) }),
}));
type AuthorityModule = typeof import("../../src/services/identity/authority");
let authority: AuthorityModule, api: Hono;
function request(overrides: Record<string, unknown> = {}, projectId = P, issuerApiKeyId = A) {
  const body = { format: "agenttool-identity-enrollment/v1", origin: ORIGIN, project_id: projectId, identity_id: I,
    signing_key_id: K, display_name: "Selected participant", capabilities: [], public_key: PUBLIC,
    nonce: Buffer.alloc(32, 8).toString("base64url"), timestamp: NOW.toISOString(), ...overrides };
  const input = { origin: ORIGIN, projectId, issuerApiKeyId, bodyBytes: Buffer.from(JSON.stringify(body)), signature: "" };
  input.signature = Buffer.from(ed.sign(canonicalIdentityEnrollmentBytes(input), PRIVATE)).toString("base64url");
  return input;
}
const options = () => ({ database, now: NOW });
async function counts() {
  const [row] = await sql`SELECT (SELECT count(*)::int FROM identity.registration_proofs) AS proofs,
    (SELECT count(*)::int FROM identity.identities) AS identities,
    (SELECT count(*)::int FROM identity.identity_keys) AS keys`;
  return row;
}
beforeAll(async () => {
  if (!DATABASE) return;
  const url = new URL(DATABASE);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.pathname !== "/agenttool_identity_enrollment_test" || url.search || url.hash) throw new Error("enrollment tests require the explicit disposable loopback database");
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
  await sql.unsafe(readFileSync(new URL("../../migrations/20260718T120000_identity_authority_root.sql", import.meta.url), "utf8"));
  // The migration carries its own BEGIN/COMMIT; the pooled fixture client runs its statements directly.
  await sql.unsafe(readFileSync(new URL("../../migrations/20260710T130000_identity_recovery_proofs.sql", import.meta.url), "utf8")
    .replace(/^\s*(BEGIN|COMMIT);\s*$/gm, ""));
  database = drizzle(sql);
  authority = await import("../../src/services/identity/authority");
  api = new Hono()
    .route("/v1/identity/recover", (await import("../../src/routes/identity-recover")).default)
    .route("/public/identities", (await import("../../src/routes/public/identities")).default);
});
beforeEach(async () => {
  if (!owned) return;
  await sql.unsafe("ALTER TABLE identity.identity_keys DROP CONSTRAINT IF EXISTS fixture_key_failure; DELETE FROM identity.recovery_proofs; DELETE FROM identity.identity_keys; DELETE FROM identity.identities; DELETE FROM identity.registration_proofs; DELETE FROM tools.api_keys; DELETE FROM tools.projects;");
  await sql`INSERT INTO tools.projects (id) VALUES (${P}),(${O})`;
  await sql`INSERT INTO tools.api_keys (id,project_id) VALUES (${A},${P}),(${O},${O})`;
});
afterAll(async () => {
  if (owned) await sql.unsafe("DROP SCHEMA identity CASCADE; DROP SCHEMA tools CASCADE;");
  await sql?.end({ timeout: 2 });
});

databaseTest("fresh enrollment persists only the selected root and key in its existing project", async () => {
  const result = await enrollIdentity(request(), options());
  expect(result.key).toEqual({ kid: K, public_key: PUBLIC });
  const [identity] = await sql`SELECT * FROM identity.identities WHERE id = ${I}`;
  expect(identity.project_id).toBe(P); expect(identity.authority_root_public_key).toBe(PUBLIC); expect(Number(identity.authority_sequence)).toBe(0);
  expect(await counts()).toEqual({ proofs: 1, identities: 1, keys: 1 });
  expect((await sql`SELECT count(*)::int AS n FROM tools.api_keys`)[0].n).toBe(2);
  expect((await sql`SELECT count(*)::int AS n FROM tools.projects`)[0].n).toBe(2);
});
databaseTest("concurrent identical proofs produce one identity and one success", async () => {
  const results = await Promise.allSettled([enrollIdentity(request(), options()), enrollIdentity(request(), options())]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  const failure = results.find(r => r.status === "rejected") as PromiseRejectedResult;
  expect(failure.reason).toMatchObject({ status: 409 });
  expect(await counts()).toEqual({ proofs: 1, identities: 1, keys: 1 });
});
databaseTest("fresh nonce cannot overwrite an existing identity or signing-key ID", async () => {
  await enrollIdentity(request(), options());
  for (const extra of [{ signing_key_id: uid(6) }, { identity_id: uid(6) }]) {
    await expect(enrollIdentity(request({ ...extra, nonce: Buffer.alloc(32, 9).toString("base64url") }), options())).rejects.toMatchObject({ status: 409 });
    expect(await counts()).toEqual({ proofs: 1, identities: 1, keys: 1 });
  }
  expect((await sql`SELECT authority_root_public_key FROM identity.identities WHERE id = ${I}`)[0].authority_root_public_key).toBe(PUBLIC);
});
databaseTest("key insertion failure rolls back both the proof claim and identity row", async () => {
  await sql.unsafe("ALTER TABLE identity.identity_keys ADD CONSTRAINT fixture_key_failure CHECK (active = false)");
  await expect(enrollIdentity(request(), options())).rejects.toBeDefined();
  expect(await counts()).toEqual({ proofs: 0, identities: 0, keys: 0 });
  await sql.unsafe("ALTER TABLE identity.identity_keys DROP CONSTRAINT fixture_key_failure");
  // This explicit test retry proves SQL rollback released the nonce/IDs; the
  // client must still inspect ambiguous outcomes instead of retrying blindly.
  await enrollIdentity(request(), options());
  expect(await counts()).toEqual({ proofs: 1, identities: 1, keys: 1 });
});
databaseTest("invalid current administrator cannot consume the participant nonce", async () => {
  await sql`UPDATE tools.api_keys SET revoked_at = ${NOW.toISOString()} WHERE id = ${A}`;
  await expect(enrollIdentity(request(), options())).rejects.toMatchObject({ status: 401 });
  await expect(enrollIdentity({ ...request(), issuerApiKeyId: O }, options())).rejects.toMatchObject({ status: 401 });
  expect(await counts()).toEqual({ proofs: 0, identities: 0, keys: 0 });
});

// ── Enrolled guest roots never speak for the administrator's project ──────
// A root admitted by enrollment governs only its own identity. Project-wide
// authority (a recovered project bearer, the project constitution, and the
// recovery discovery that advertises it) stays with founding roots born by
// register-agent/MATHOS and with legacy rootless identities.
const F = uid(21), FI = uid(22), FK = uid(23), FA = uid(24), L = uid(25), LK = uid(26);
const FOUNDER_PRIVATE = new Uint8Array(32).fill(11), FOUNDER_PUBLIC = Buffer.from(ed.getPublicKey(FOUNDER_PRIVATE)).toString("base64");
const LEGACY_PRIVATE = new Uint8Array(32).fill(13), LEGACY_PUBLIC = Buffer.from(ed.getPublicKey(LEGACY_PRIVATE)).toString("base64");
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
async function foundProject() {
  await sql`INSERT INTO tools.projects (id) VALUES (${F})`;
  await sql`INSERT INTO tools.api_keys (id,project_id) VALUES (${FA},${F})`;
  await sql`INSERT INTO identity.identities (id,did,project_id,display_name,metadata,status,trust_score,authority_root_public_key,authority_sequence)
    VALUES (${FI},${`did:at:${FI}`},${F},'Founder',${JSON.stringify({ registered: true, byo_keys: true, level: 0 })}::jsonb,'active',0,${FOUNDER_PUBLIC},0)`;
  await sql`INSERT INTO identity.identity_keys (id,identity_id,public_key,label,active) VALUES (${FK},${FI},${FOUNDER_PUBLIC},'primary',true)`;
}
async function legacyIdentity() {
  await sql`INSERT INTO identity.identities (id,did,project_id,display_name,metadata,status,trust_score)
    VALUES (${L},${`did:at:${L}`},${P},'Legacy','{}'::jsonb,'active',0)`;
  await sql`INSERT INTO identity.identity_keys (id,identity_id,public_key,label,active) VALUES (${LK},${L},${LEGACY_PUBLIC},'primary',true)`;
}
function recoverBody(did: string, publicKey: string, privateKey: Uint8Array) {
  const timestamp = new Date().toISOString();
  const signature = b64(ed.sign(canonicalRecoverBytes({ did, derivedPubkeyB64: publicKey, timestamp }), privateKey));
  return JSON.stringify({ did, derived_pubkey: publicKey, signature, timestamp, device_label: "integration" });
}
function authorityHeaders(did: string, body: string, sequence: number, privateKey: Uint8Array) {
  const timestamp = new Date().toISOString();
  const bytes = authority.canonicalIdentityAuthorityBytes({ identityDid: did, method: "POST", requestTarget: "/v1/identity/recover",
    bodyBytes: new TextEncoder().encode(body), sequence, timestamp });
  return { [authority.AUTHORITY_HEADERS.sequence]: String(sequence), [authority.AUTHORITY_HEADERS.timestamp]: timestamp,
    [authority.AUTHORITY_HEADERS.signature]: b64(ed.sign(bytes, privateKey)) };
}
const recover = (body: string, headers: Record<string, string> = {}) =>
  api.request("/v1/identity/recover", { method: "POST", body, headers: { "content-type": "application/json", ...headers } });
const bearersFor = async (project: string) => (await sql`SELECT count(*)::int AS n FROM tools.api_keys WHERE project_id = ${project}`)[0].n;
const projectGuard = (projectId: string) => authority.authorizeProjectConstitutionMutation({
  projectId, method: "PATCH", requestTarget: "/v1/memories/00000000-1111-4111-8111-111111111111", bodyBytes: new Uint8Array(), headers: new Headers() });

databaseTest("an enrolled guest root cannot recover a bearer for the administrator's project", async () => {
  await enrollIdentity(request(), options());
  const body = recoverBody(`did:at:${I}`, PUBLIC, PRIVATE);
  for (const headers of [{}, authorityHeaders(`did:at:${I}`, body, 1, PRIVATE)]) {
    const res = await recover(body, headers);
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("recovery_not_authorized");
  }
  expect(await bearersFor(P)).toBe(1);
  // Refused before the authority cursor: the guest's own sequence is untouched.
  expect(Number((await sql`SELECT authority_sequence FROM identity.identities WHERE id = ${I}`)[0].authority_sequence)).toBe(0);
});
databaseTest("a founding root and a legacy key still recover their own project", async () => {
  await foundProject();
  const founderDid = `did:at:${FI}`;
  const body = recoverBody(founderDid, FOUNDER_PUBLIC, FOUNDER_PRIVATE);
  const required = await recover(body);
  expect(required.status).toBe(428);
  const minted = await recover(body, authorityHeaders(founderDid, body, 1, FOUNDER_PRIVATE));
  expect(minted.status).toBe(201);
  expect((await minted.json()).project.id).toBe(F);
  expect(await bearersFor(F)).toBe(2);

  await legacyIdentity();
  const legacy = await recover(recoverBody(`did:at:${L}`, LEGACY_PUBLIC, LEGACY_PRIVATE));
  expect(legacy.status).toBe(201);
  expect(await bearersFor(P)).toBe(2);
});
databaseTest("recovery discovery never advertises an enrolled guest root", async () => {
  await enrollIdentity(request(), options());
  await foundProject();
  const discover = async (publicKey: string, privateKey: Uint8Array) => {
    const timestamp = new Date().toISOString();
    const signature = b64(ed.sign(canonicalDiscoveryBytes({ derivedPubkeyB64: publicKey, timestamp }), privateKey));
    const res = await api.request("/public/identities/by-pubkey", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ pubkey: publicKey, signature, timestamp }) });
    expect(res.status).toBe(200);
    return ((await res.json()).agents as Array<{ identity_id: string }>).map(agent => agent.identity_id);
  };
  expect(await discover(PUBLIC, PRIVATE)).toEqual([]);
  expect(await discover(FOUNDER_PUBLIC, FOUNDER_PRIVATE)).toEqual([FI]);
});
databaseTest("an enrolled guest root does not join the project constitution", async () => {
  await enrollIdentity(request(), options());
  expect(await projectGuard(P)).toMatchObject({ ok: true, mode: "legacy_bearer" });

  await foundProject();
  await enrollIdentity(request({ identity_id: uid(28), signing_key_id: uid(29), nonce: Buffer.alloc(32, 10).toString("base64url") }, F, FA), options());
  const guested = (await sql`SELECT count(*)::int AS n FROM identity.identities WHERE project_id = ${F}`)[0].n;
  expect(guested).toBe(2);
  const decision = await projectGuard(F);
  // One founding root speaks; the guest does not turn it into a quorum refusal.
  expect(decision).toMatchObject({ ok: false, status: 428 });
});
