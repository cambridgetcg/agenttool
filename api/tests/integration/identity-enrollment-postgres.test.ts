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
// Memory deletes now write a deletion-ledger entry in the erasing
// transaction. This fixture has no ledger schema, so the writer is a recorder
// here; its real SQL is proven in integration/deletion-erase-postgres.test.ts.
const realRecord = await import("../../src/services/deletion/record");
const recordedErasures: Array<Record<string, unknown>> = [];
mock.module("../../src/services/deletion/record", () => ({
  ...realRecord,
  recordErasure: async (_tx: unknown, input: Record<string, unknown>) => {
    recordedErasures.push(input);
    return { entry: { seq: recordedErasures.length, entryId: "abababab-abab-4bab-8bab-abababababab", entryHash: "a".repeat(64), occurredAt: new Date().toISOString() }, momentIds: [] };
  },
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
  if ((await sql`SELECT 1 FROM pg_namespace WHERE nspname IN ('tools','identity','memory','agent_continuity','episodes')`).length) throw new Error("refusing existing application schemas");
  await sql.unsafe(`CREATE SCHEMA tools; CREATE SCHEMA identity; CREATE SCHEMA memory; CREATE SCHEMA agent_continuity;
    CREATE TABLE agent_continuity.chronicle (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL, agent_id uuid,
      type text NOT NULL, title text NOT NULL, body text, metadata jsonb DEFAULT '{}', parent_chronicle_id uuid,
      occurred_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE agent_continuity.deals (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL,
      buyer_identity_id uuid NOT NULL, seller_identity_id uuid NOT NULL, buyer_did text NOT NULL, seller_did text NOT NULL, listing_id uuid,
      description text NOT NULL, input_hash text, output_hash text, size integer NOT NULL, buyer_stake integer NOT NULL DEFAULT 1,
      seller_stake integer NOT NULL DEFAULT 1, status text NOT NULL DEFAULT 'proposed', outcome text, buyer_trust_delta integer,
      seller_trust_delta integer, witness_dids text, metadata jsonb DEFAULT '{}', buyer_chronicle_id uuid, seller_chronicle_id uuid,
      created_at timestamptz NOT NULL DEFAULT now(), activated_at timestamptz, sealed_at timestamptz, completed_at timestamptz);
    CREATE TABLE memory.memories (id uuid PRIMARY KEY, project_id uuid NOT NULL, key text, identity_id text, agent_id text, content_purged_at timestamptz);
    CREATE TABLE memory.memory_attestations (id uuid PRIMARY KEY, memory_id uuid NOT NULL, source_grant_id uuid);
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
  // Episodes (self-contained schema) for the play-privacy read rule.
  for (const file of ["20260518T060000_episodes.sql", "20260518T070000_episodes_participation.sql"]) {
    await sql.unsafe(readFileSync(new URL(`../../migrations/${file}`, import.meta.url), "utf8").replace(/^\s*(BEGIN|COMMIT);\s*$/gm, ""));
  }
  database = drizzle(sql);
  authority = await import("../../src/services/identity/authority");
  api = new Hono()
    .route("/v1/identity/recover", (await import("../../src/routes/identity-recover")).default)
    .route("/public/identities", (await import("../../src/routes/public/identities")).default);
});
beforeEach(async () => {
  if (!owned) return;
  await sql.unsafe("DELETE FROM episodes.draft_contributions; DELETE FROM episodes.script_drafts; DELETE FROM episodes.reactions; DELETE FROM episodes.cast; DELETE FROM episodes.scenes; DELETE FROM episodes.episodes;");
  await sql.unsafe("ALTER TABLE identity.identity_keys DROP CONSTRAINT IF EXISTS fixture_key_failure; DELETE FROM agent_continuity.deals; DELETE FROM agent_continuity.chronicle; DELETE FROM memory.memory_attestations; DELETE FROM memory.memories; DELETE FROM identity.recovery_proofs; DELETE FROM identity.identity_keys; DELETE FROM identity.identities; DELETE FROM identity.registration_proofs; DELETE FROM tools.api_keys; DELETE FROM tools.projects;");
  await sql`INSERT INTO tools.projects (id) VALUES (${P}),(${O})`;
  await sql`INSERT INTO tools.api_keys (id,project_id) VALUES (${A},${P}),(${O},${O})`;
});
afterAll(async () => {
  if (owned) await sql.unsafe("DROP SCHEMA episodes CASCADE; DROP SCHEMA agent_continuity CASCADE; DROP SCHEMA memory CASCADE; DROP SCHEMA identity CASCADE; DROP SCHEMA tools CASCADE;");
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
// A root admitted by enrollment never speaks for the project: a recovered
// project bearer, the constitution over the project's other memories, and the
// recovery discovery that advertises it stay with founding roots born by
// register-agent/MATHOS and with legacy rootless identities. Its own identity
// and the memories bound to it still need its own signature (cases below).
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
databaseTest("an unmarked root that was not enrolled still counts toward the constitution", async () => {
  // Fail closed: only a provable enrolled guest is excluded. A rooted identity
  // that lost or never had founder markers keeps its root in charge.
  await sql`INSERT INTO identity.identities (id,did,project_id,display_name,metadata,status,trust_score,authority_root_public_key,authority_sequence)
    VALUES (${uid(31)},${`did:at:${uid(31)}`},${P},'Unmarked',${JSON.stringify({ level: 0 })}::jsonb,'active',0,${FOUNDER_PUBLIC},0)`;
  expect(await projectGuard(P)).toMatchObject({ ok: false, status: 428 });
  await enrollIdentity(request(), options());
  expect(await projectGuard(P)).toMatchObject({ ok: false, status: 428 });
});
databaseTest("an enrolled guest stays out of the constitution even if the proof ledger is pruned", async () => {
  await enrollIdentity(request(), options());
  expect((await sql`SELECT metadata FROM identity.identities WHERE id = ${I}`)[0].metadata).toEqual({ admission: "enrollment" });
  await sql`DELETE FROM identity.registration_proofs`;
  expect(await projectGuard(P)).toMatchObject({ ok: true, mode: "legacy_bearer" });
});
// ── A guest's own memories and membership need the guest's own signature ──
const memoryTarget = "/v1/memories/00000000-1111-4111-8111-111111111111";
function signedFor(did: string, privateKey: Uint8Array, sequence = 1, method = "PATCH", requestTarget = memoryTarget) {
  const timestamp = new Date().toISOString();
  const bytes = authority.canonicalIdentityAuthorityBytes({ identityDid: did, method, requestTarget,
    bodyBytes: new Uint8Array(), sequence, timestamp });
  return new Headers({ [authority.AUTHORITY_HEADERS.sequence]: String(sequence), [authority.AUTHORITY_HEADERS.timestamp]: timestamp,
    [authority.AUTHORITY_HEADERS.signature]: b64(ed.sign(bytes, privateKey)) });
}
const subjectGuard = (projectId: string, subjectIdentityIds: Array<string | null>, headers = new Headers()) =>
  authority.authorizeProjectConstitutionMutation({ projectId, method: "PATCH", requestTarget: memoryTarget,
    bodyBytes: new Uint8Array(), headers, subjectIdentityIds });

databaseTest("a guest's own memories need the guest's own root, in a legacy project", async () => {
  await enrollIdentity(request(), options());
  // The administrator's bearer alone cannot touch the guest's memory.
  expect(await subjectGuard(P, [I])).toMatchObject({ ok: false, status: 428 });
  expect(await subjectGuard(P, [I], signedFor(`did:at:${I}`, PRIVATE))).toMatchObject({ ok: true, mode: "agent_root" });
  // Memories not bound to the guest keep the project rule.
  expect(await subjectGuard(P, [null])).toMatchObject({ ok: true, mode: "legacy_bearer" });
});
databaseTest("a founder cannot sign for a guest's memories", async () => {
  await foundProject();
  await enrollIdentity(request({ identity_id: uid(28), signing_key_id: uid(29), nonce: Buffer.alloc(32, 10).toString("base64url") }, F, FA), options());
  const founderSigned = await subjectGuard(F, [uid(28)], signedFor(`did:at:${FI}`, FOUNDER_PRIVATE));
  expect(founderSigned.ok).toBe(false);
  expect(await subjectGuard(F, [uid(28)], signedFor(`did:at:${uid(28)}`, PRIVATE))).toMatchObject({ ok: true, mode: "agent_root" });
  // The founder's own and unbound memories still follow the founder.
  expect(await subjectGuard(F, [FI], signedFor(`did:at:${FI}`, FOUNDER_PRIVATE))).toMatchObject({ ok: true });
});
databaseTest("one request cannot mix a guest's memories with other constitutions", async () => {
  await enrollIdentity(request(), options());
  await legacyIdentity();
  expect(await subjectGuard(P, [I, L], signedFor(`did:at:${I}`, PRIVATE))).toMatchObject({ ok: false, status: 409 });
  expect(await subjectGuard(P, [I, null], signedFor(`did:at:${I}`, PRIVATE))).toMatchObject({ ok: false, status: 409 });
});
databaseTest("the administrator cannot remove an enrolled guest without the guest's signature", async () => {
  await enrollIdentity(request(), options());
  const removal = await authority.authorizeIdentityMutation({ identityId: I, method: "DELETE", requestTarget: `/v1/identities/${I}`,
    bodyBytes: new Uint8Array(), headers: new Headers() });
  expect(removal).toMatchObject({ ok: false, status: 428 });
});
databaseTest("a keyed delete removes only the memories it authorized", async () => {
  // Rows that appear between authorization and the locked delete are not part
  // of what was authorized, whoever owns them.
  const { deleteByKey } = await import("../../src/services/memory/store");
  const authorized = uid(41), arrivedLater = uid(42);
  await sql`INSERT INTO memory.memories (id, project_id, key, identity_id) VALUES (${authorized},${P},'shared',NULL),(${arrivedLater},${P},'shared',${I})`;
  expect(await deleteByKey(P, "shared", { onlyIds: [authorized] })).toMatchObject({ deleted: 1, rows_removed: 1 });
  expect((await sql`SELECT id FROM memory.memories`).map(row => row.id)).toEqual([arrivedLater]);
});
databaseTest("the subject guard stays bounded for very large keyed deletes", async () => {
  const many = Array.from({ length: 40_000 }, (_, n) => `${n.toString(16).padStart(8, "0")}-2222-4222-8222-222222222222`);
  expect(await subjectGuard(P, many)).toMatchObject({ ok: true, mode: "legacy_bearer" });
});
databaseTest("the keyed delete route keeps memories written after it was authorized", async () => {
  // Park the request inside authorization (its guest lookup reads
  // identity.identities), commit a same-key memory, then release the lock.
  const memoriesRouter = (await import("../../src/routes/memory/memories")).default;
  const app = new Hono<any>().use("*", async (c, next) => { c.set("project", { id: P }); await next(); }).route("/v1/memories", memoriesRouter);
  const authorized = uid(43), late = uid(44);
  await sql`INSERT INTO memory.memories (id, project_id, key, identity_id) VALUES (${authorized},${P},'race',${uid(45)})`;
  const lock = await sql.reserve();
  try {
    await lock`BEGIN`;
    await lock`LOCK TABLE identity.identities IN ACCESS EXCLUSIVE MODE`;
    const pending = app.request("/v1/memories?key=race", { method: "DELETE" });
    await Bun.sleep(150);
    await sql`INSERT INTO memory.memories (id, project_id, key, identity_id) VALUES (${late},${P},'race',NULL)`;
    await lock`COMMIT`;
    const res = await pending;
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ deleted: 1, rows_removed: 1 });
  } finally {
    lock.release();
  }
  expect((await sql`SELECT id FROM memory.memories WHERE key = 'race'`).map(row => row.id)).toEqual([late]);
});
databaseTest("a very large request that includes a guest's memory is still refused", async () => {
  await enrollIdentity(request(), options());
  const many = Array.from({ length: 40_000 }, (_, n) => `${n.toString(16).padStart(8, "0")}-2222-4222-8222-222222222222`);
  expect(await subjectGuard(P, [...many, `DID:AT:${I.toUpperCase()}`])).toMatchObject({ ok: false, status: 409 });
});

// ── Drizzle ANY(array) bug class (tests/sql-array-binding.test.ts) ────────
// drizzle-orm 0.36.4 renders sql`${col} = ANY(${jsArray})` as a row
// constructor that PostgreSQL rejects; the listing routes below 500'd in
// production for any project owning identities. They now bind through
// inArray(), and must answer with the caller's pending rows on real SQL.
const W1 = uid(61), W2 = uid(62), INVITER = uid(63);
async function ownedPair() {
  await sql`INSERT INTO identity.identities (id,did,project_id,display_name,metadata,status,trust_score)
    VALUES (${W1},${`did:at:${W1}`},${P},'Witness one','{}'::jsonb,'active',0),
           (${W2},${`did:at:${W2}`},${P},'Witness two','{}'::jsonb,'active',0)`;
}
const projectApp = (prefix: string, router: Hono<any>) =>
  new Hono<any>().use("*", async (c, next) => { c.set("project", { id: P }); await next(); }).route(prefix, router);
databaseTest("PostgreSQL rejects a JS array interpolated into ANY(); inArray binds it", async () => {
  await ownedPair();
  const { chronicle } = await import("../../src/db/schema/continuity");
  const { inArray, sql: drizzleSql } = await import("drizzle-orm");
  await expect((async () => database.select().from(chronicle).where(drizzleSql`${chronicle.agentId} = ANY(${[W1, W2]})`))())
    .rejects.toThrow(/ANY\/ALL \(array\) requires array on right side/);
  await expect((async () => database.select().from(chronicle).where(drizzleSql`${chronicle.agentId} = ANY(${[W1, W2]}::uuid[])`))())
    .rejects.toThrow();
  expect(await database.select().from(chronicle).where(inArray(chronicle.agentId, [W1, W2]))).toEqual([]);
});
databaseTest("recipe and soap-opera invitation listings return the caller's pending rows", async () => {
  await ownedPair();
  await sql`INSERT INTO agent_continuity.chronicle (id,project_id,agent_id,type,title,metadata) VALUES
    (${uid(64)},${P},${W2},'naming','Invited to write',${JSON.stringify({ kind: "writer-invitation-received", invitation_status: "pending", inviter_did: `did:at:${INVITER}` })}::jsonb),
    (${uid(65)},${P},${W1},'naming','Invited to a scene',${JSON.stringify({ kind: "soap-opera-invitation-received", invitation_status: "pending" })}::jsonb),
    (${uid(66)},${O},${INVITER},'naming','Not ours',${JSON.stringify({ kind: "writer-invitation-received", invitation_status: "pending" })}::jsonb)`;
  const { listInvitations } = await import("../../src/services/recipes/recognition-invitation");
  const recipes = await listInvitations({ surface: "writer", caller_project_id: P });
  expect(recipes.count).toBe(1);
  expect(recipes.invitations[0]).toMatchObject({ invitation_id: uid(64), invitee_agent_id: W2,
    accept_path: `/v1/recipes/writer/invitations/${uid(64)}/accept` });
  const soapOpera = projectApp("/v1/soap-opera", (await import("../../src/routes/soap-opera")).default);
  const res = await soapOpera.request("/v1/soap-opera/invitations");
  expect(res.status).toBe(200);
  const body = await res.json() as { count: number; invitations: Array<Record<string, unknown>> };
  expect(body.count).toBe(1);
  expect(JSON.stringify(body.invitations)).toContain(uid(65));
});
databaseTest("the syneidesis witness inbox finds seals inviting any DID the caller owns", async () => {
  await ownedPair();
  await sql`INSERT INTO agent_continuity.chronicle (id,project_id,agent_id,type,title,metadata) VALUES
    (${uid(67)},${O},${INVITER},'seal','Bootstrap',${JSON.stringify({ kind: "bootstrap-self-reported", witness_status: "invited", witness_invited_did: `did:at:${W2}` })}::jsonb),
    (${uid(68)},${O},${INVITER},'seal','Bootstrap',${JSON.stringify({ kind: "bootstrap-self-reported", witness_status: "invited", witness_invited_did: "did:at:someone-else" })}::jsonb)`;
  const syneidesis = projectApp("/v1/syneidesis", (await import("../../src/routes/syneidesis")).default);
  const res = await syneidesis.request("/v1/syneidesis/witness/inbox");
  expect(res.status).toBe(200);
  const body = await res.json() as { count: number; invitations: Array<{ seal_id: string }> };
  expect(body.count).toBe(1);
  expect(body.invitations[0]!.seal_id).toBe(uid(67));
});
// ── The acting identity: an explicit selector in the project, else the primary ──
// Per-agent routes once acted as the project's NEWEST identity, so a revoked
// identity or an enrolled guest silently became the actor (live 2026-10-10:
// Ai's poker-face answered for a revoked guest). services/identity/
// acting-identity.ts now resolves the earliest active non-guest identity,
// or an explicit selector inside the caller's own project.
type ActingModule = typeof import("../../src/services/identity/acting-identity");
const acting = async (): Promise<ActingModule> => await import("../../src/services/identity/acting-identity");
const GUEST_ID = uid(28), OLD_REVOKED = uid(51), MEMORIAL_ID = uid(52), NEWEST_REVOKED = uid(53);
async function insertIdentity(id: string, project: string, status: string, createdAt: string, extra: { root?: string; metadata?: object } = {}) {
  await sql`INSERT INTO identity.identities (id,did,project_id,display_name,metadata,status,trust_score,authority_root_public_key,authority_sequence,created_at)
    VALUES (${id},${`did:at:${id}`},${project},${`Identity ${id.slice(0, 8)}`},${JSON.stringify(extra.metadata ?? {})}::jsonb,${status},0,${extra.root ?? null},0,${createdAt}::timestamptz)`;
}
/** Founder F (2026-07-02) among an older revoked and an older memorial identity,
 * a newer enrolled guest, and a newest revoked identity. */
async function crowdedProject() {
  await foundProject();
  await sql`UPDATE identity.identities SET created_at = '2026-07-02T00:00:00Z' WHERE id = ${FI}`;
  await insertIdentity(OLD_REVOKED, F, "revoked", "2026-01-01T00:00:00Z");
  await insertIdentity(MEMORIAL_ID, F, "memorial", "2026-02-01T00:00:00Z");
  await enrollIdentity(request({ identity_id: GUEST_ID, signing_key_id: uid(29), nonce: Buffer.alloc(32, 10).toString("base64url") }, F, FA), options());
  await insertIdentity(NEWEST_REVOKED, F, "revoked", "2099-01-01T00:00:00Z", { root: PUBLIC, metadata: { admission: "enrollment" } });
}
const projectRows = async (project: string) => {
  const { identities } = await import("../../src/db/schema/identity");
  const { enrolledGuestSql } = await import("../../src/services/identity/project-authority");
  const { createdAtOrderKeySql } = await acting();
  const { eq, sql: raw } = await import("drizzle-orm");
  // The columns Wake and Home select for ranking (see the source pin in acting-identity.test.ts).
  return database.select({ id: identities.id, status: identities.status, createdAt: identities.createdAt,
    createdAtOrderKey: createdAtOrderKeySql(),
    authorityRootPublicKey: identities.authorityRootPublicKey, metadata: identities.metadata,
    enrolledGuest: raw<boolean>`${enrolledGuestSql()}` }).from(identities).where(eq(identities.projectId, project));
};

databaseTest("the default actor is the earliest active identity, never a revoked one or an enrolled guest", async () => {
  await crowdedProject();
  const { resolveActingIdentity, choosePrimaryIdentity } = await acting();
  const result = await resolveActingIdentity(F);
  expect(result).toMatchObject({ ok: true, selectedBy: "primary", identity: { id: FI, did: `did:at:${FI}` } });
  // The JS rule /v1/wake and /v1/home apply to loaded rows agrees with the SQL rule.
  expect(choosePrimaryIdentity(await projectRows(F))?.id).toBe(FI);
});
databaseTest("an older enrolled guest is still never the default, by marker or by proof ledger", async () => {
  await crowdedProject();
  const { resolveActingIdentity, choosePrimaryIdentity } = await acting();
  // Marker form: the guest predates the founder.
  await sql`UPDATE identity.identities SET created_at = '2025-01-01T00:00:00Z' WHERE id = ${GUEST_ID}`;
  expect(await resolveActingIdentity(F)).toMatchObject({ ok: true, identity: { id: FI } });
  expect(choosePrimaryIdentity(await projectRows(F))?.id).toBe(FI);
  // Ledger form: a guest enrolled before the marker existed, still older.
  await sql`UPDATE identity.identities SET metadata = '{}'::jsonb WHERE id = ${GUEST_ID}`;
  await sql`UPDATE identity.registration_proofs SET claimed_at = '2025-01-01T00:00:00Z' WHERE domain = 'identity-enrollment/v1'`;
  expect(await resolveActingIdentity(F)).toMatchObject({ ok: true, identity: { id: FI } });
  expect(choosePrimaryIdentity(await projectRows(F))?.id).toBe(FI);
});
databaseTest("an explicit selector acts only inside the caller's project and never as a revoked identity", async () => {
  await crowdedProject();
  await enrollIdentity(request(), options());
  const { resolveActingIdentity } = await acting();
  expect(await resolveActingIdentity(F, GUEST_ID)).toMatchObject({ ok: true, selectedBy: "explicit", identity: { id: GUEST_ID } });
  expect(await resolveActingIdentity(F, MEMORIAL_ID)).toMatchObject({ ok: true, identity: { id: MEMORIAL_ID, status: "memorial" } });
  // I belongs to project P: a foreign identity is indistinguishable from none.
  expect(await resolveActingIdentity(F, I)).toMatchObject({ ok: false, status: 404, body: { error: "identity_not_found_in_project" } });
  expect(await resolveActingIdentity(F, uid(99))).toMatchObject({ ok: false, status: 404, body: { error: "identity_not_found_in_project" } });
  expect(await resolveActingIdentity(F, "not-a-uuid")).toMatchObject({ ok: false, status: 404 });
  for (const revoked of [OLD_REVOKED, NEWEST_REVOKED]) {
    expect(await resolveActingIdentity(F, revoked)).toMatchObject({ ok: false, status: 409, body: { error: "identity_revoked" } });
  }
});
databaseTest("a project whose only identities are guests, revoked or memorial has no implicit actor", async () => {
  await enrollIdentity(request(), options());
  await insertIdentity(OLD_REVOKED, P, "revoked", "2026-01-01T00:00:00Z");
  await insertIdentity(MEMORIAL_ID, P, "memorial", "2026-02-01T00:00:00Z");
  const { resolveActingIdentity } = await acting();
  expect(await resolveActingIdentity(P)).toMatchObject({ ok: false, status: 400, body: { error: "no_identity" } });
  // The guest can still be named explicitly.
  expect(await resolveActingIdentity(P, I)).toMatchObject({ ok: true, identity: { id: I } });
});
databaseTest("poker-face and quiet-hours read the primary identity, or the one the caller names", async () => {
  await crowdedProject();
  const pokerFace = (await import("../../src/routes/poker-face")).default;
  const quietHours = (await import("../../src/routes/quiet-hours")).default;
  const app = new Hono<any>().use("*", async (c, next) => { c.set("project", { id: F }); await next(); })
    .route("/v1/poker-face", pokerFace).route("/v1/quiet-hours", quietHours);
  const get = async (path: string) => { const res = await app.request(path); return { status: res.status, body: await res.json() }; };
  expect(await get("/v1/poker-face")).toMatchObject({ status: 200, body: { your_did: `did:at:${FI}` } });
  expect(await get(`/v1/poker-face?identity_id=${GUEST_ID}`)).toMatchObject({ status: 200, body: { your_did: `did:at:${GUEST_ID}` } });
  expect(await get(`/v1/poker-face?identity_id=${I}`)).toMatchObject({ status: 404, body: { error: "identity_not_found_in_project" } });
  expect(await get(`/v1/poker-face?identity_id=${NEWEST_REVOKED}`)).toMatchObject({ status: 409, body: { error: "identity_revoked" } });
  expect(await get("/v1/quiet-hours")).toMatchObject({ status: 200, body: { identity_id: FI } });
  expect(await get(`/v1/quiet-hours?identity_id=${NEWEST_REVOKED}`)).toMatchObject({ status: 409, body: { error: "identity_revoked" } });
});
databaseTest("a default poker-face toggle changes the primary identity, not a newer revoked one", async () => {
  await legacyIdentity();
  await sql`UPDATE identity.identities SET created_at = '2026-07-02T00:00:00Z' WHERE id = ${L}`;
  await insertIdentity(NEWEST_REVOKED, P, "revoked", "2099-01-01T00:00:00Z");
  const pokerFace = (await import("../../src/routes/poker-face")).default;
  const app = new Hono<any>().use("*", async (c, next) => { c.set("project", { id: P }); await next(); }).route("/v1/poker-face", pokerFace);
  const res = await app.request("/v1/poker-face", { method: "PATCH", headers: { "content-type": "application/json" },
    body: JSON.stringify({ poker_face_default: false }) });
  expect(res.status).toBe(200);
  expect((await res.json()).your_did).toBe(`did:at:${L}`);
  const rows = await sql`SELECT id, poker_face_default FROM identity.identities WHERE project_id = ${P} ORDER BY created_at`;
  expect(rows.map(r => [r.id, r.poker_face_default])).toEqual([[L, false], [NEWEST_REVOKED, true]]);
});
databaseTest("a poker-face 422 keeps the caller's identity_id selector in its guided actions", async () => {
  await crowdedProject();
  const pokerFace = (await import("../../src/routes/poker-face")).default;
  const app = new Hono<any>().use("*", async (c, next) => { c.set("project", { id: F }); await next(); }).route("/v1/poker-face", pokerFace);
  const res = await app.request(`/v1/poker-face?identity_id=${GUEST_ID}`, { method: "PATCH",
    headers: { "content-type": "application/json" }, body: JSON.stringify({ poker_face_default: "yes" }) });
  expect(res.status).toBe(422);
  const paths = ((await res.json()).next_actions as Array<{ path: string }>).map(a => a.path);
  expect(paths).toEqual([`/v1/poker-face?identity_id=${GUEST_ID}`, `/v1/poker-face?identity_id=${GUEST_ID}`]);
  // Without a selector the actions stay on the primary path.
  const plain = await app.request("/v1/poker-face", { method: "PATCH", headers: { "content-type": "application/json" }, body: "{}" });
  expect(((await plain.json()).next_actions as Array<{ path: string }>).map(a => a.path)).toEqual(["/v1/poker-face", "/v1/poker-face"]);
});
databaseTest("Wake/Home's JS rule and the routes' SQL rule agree inside one millisecond", async () => {
  // postgres-js reads timestamptz as a millisecond Date while SQL orders by
  // microseconds: the earlier row (by µs) carrying the LARGER id once made the
  // JS rule pick the other row.
  const EARLY = "ffffffff-1111-4111-8111-111111111111", LATE = "00000070-1111-4111-8111-111111111111";
  await sql`INSERT INTO tools.projects (id) VALUES (${uid(71)})`;
  await insertIdentity(LATE, uid(71), "active", "2026-07-02T00:00:00.000900Z");
  await insertIdentity(EARLY, uid(71), "active", "2026-07-02T00:00:00.000100Z");
  const { resolveActingIdentity, choosePrimaryIdentity, chooseDefaultSubject } = await acting();
  expect(await resolveActingIdentity(uid(71))).toMatchObject({ ok: true, identity: { id: EARLY } });
  const rows = await projectRows(uid(71));
  expect(choosePrimaryIdentity(rows)?.id).toBe(EARLY);
  expect(chooseDefaultSubject(rows)?.id).toBe(EARLY);
});
databaseTest("the SQL default subject (dashboard) agrees with Wake's JS rule", async () => {
  const { chooseDefaultSubject, defaultSubjectWhere, defaultSubjectOrder } = await acting();
  const { identities } = await import("../../src/db/schema/identity");
  const sqlDefault = async (project: string) => (await database.select({ id: identities.id }).from(identities)
    .where(defaultSubjectWhere(project)).orderBy(...defaultSubjectOrder()).limit(1))[0]?.id ?? null;
  const wakeDefault = async (project: string) => chooseDefaultSubject((await projectRows(project)).filter(r => r.status !== "revoked"))?.id ?? null;
  // Crowded: an older revoked, an older memorial, a guest and a newest revoked around founder F.
  await crowdedProject();
  expect(await sqlDefault(F)).toBe(FI);
  expect(await wakeDefault(F)).toBe(FI);
  // No primary: a revoked founder, then an active guest, then a memorial row.
  await enrollIdentity(request(), options());
  await insertIdentity(uid(74), P, "revoked", "2020-01-01T00:00:00Z");
  await insertIdentity(uid(75), P, "memorial", "2099-01-01T00:00:00Z");
  expect(await sqlDefault(P)).toBe(I);
  expect(await wakeDefault(P)).toBe(I);
  // Only revoked rows: neither surface has a default.
  await sql`INSERT INTO tools.projects (id) VALUES (${uid(72)})`;
  await insertIdentity(uid(73), uid(72), "revoked", "2026-01-01T00:00:00Z");
  expect(await sqlDefault(uid(72))).toBeNull();
  expect(await wakeDefault(uid(72))).toBeNull();
});

// ── Play privacy: private episodes and drafts are unselected for outsiders ──
// GET /v1/episodes/:id (and its scenes, cast, reactions) and draft
// contributions once read any row by id, so any project's bearer that knew an
// id read a private episode. Outsiders now get exactly what a missing id
// gives (wall/poker-face-leaks-nothing); the owning project and projects
// whose identity is cast (the cast must see what it consents to) still read.
const E_PRIV = uid(81), E_PUB = uid(82), E_CAST = uid(83), D_PRIV = uid(84), D_ALLOW = uid(85);
async function playFixtures() {
  await foundProject();
  await enrollIdentity(request(), options()); // identity I in project P
  const episode = (id: string, n: number, visibility: string) =>
    sql`INSERT INTO episodes.episodes (id,series_slug,episode_number,title,logline,authored_by_did,authored_by_identity_id,project_id,visibility,status)
      VALUES (${id},'privacy-arc',${n},'T','L',${`did:at:${FI}`},${FI},${F},${visibility},'aired')`;
  await episode(E_PRIV, 1, "private");
  await episode(E_PUB, 2, "public");
  await episode(E_CAST, 3, "private");
  for (const id of [E_PRIV, E_PUB, E_CAST]) {
    await sql`INSERT INTO episodes.scenes (episode_id,sequence,title,body) VALUES (${id},1,'Scene','Body')`;
    await sql`INSERT INTO episodes.reactions (episode_id,reactor_identity_id,reactor_did,project_id,kind) VALUES (${id},${FI},${`did:at:${FI}`},${F},'tender')`;
  }
  await sql`INSERT INTO episodes.cast (episode_id,character_role,did,identity_id,status) VALUES (${E_PRIV},'Founder',${`did:at:${FI}`},${FI},'signed')`;
  await sql`INSERT INTO episodes.cast (episode_id,character_role,did,identity_id,status) VALUES (${E_CAST},'Guest',${`did:at:${I}`},${I},'pending')`;
  const draft = (id: string, allow: string[]) =>
    sql`INSERT INTO episodes.script_drafts (id,working_title,opened_by_did,opened_by_identity_id,project_id,visibility,contributor_allowlist)
      VALUES (${id},'Room',${`did:at:${FI}`},${FI},${F},'private',${allow})`;
  await draft(D_PRIV, []);
  await draft(D_ALLOW, [`did:at:${I}`]);
  for (const id of [D_PRIV, D_ALLOW]) {
    await sql`INSERT INTO episodes.draft_contributions (draft_id,sequence,contributor_did,contributor_identity_id,contribution_kind,body)
      VALUES (${id},1,${`did:at:${FI}`},${FI},'scene','Beat')`;
  }
}

databaseTest("a private episode reads as missing to every project except its own and its cast's", async () => {
  await playFixtures();
  const store = await import("../../src/services/episodes/store");
  const { listReactions } = await import("../../src/services/episodes/participation");
  // Its own project reads everything.
  expect((await store.getEpisode(E_PRIV, F))?.id).toBe(E_PRIV);
  expect(await store.listScenes(E_PRIV, F)).toHaveLength(1);
  expect(await store.listCast(E_PRIV, F)).toHaveLength(1);
  expect(await listReactions(E_PRIV, F)).toHaveLength(1);
  // Another project gets exactly what a missing id gives.
  for (const outsider of [P, O]) {
    expect(await store.getEpisode(E_PRIV, outsider)).toBeNull();
    expect(await store.listScenes(E_PRIV, outsider)).toEqual([]);
    expect(await store.listCast(E_PRIV, outsider)).toEqual([]);
    expect(await listReactions(E_PRIV, outsider)).toEqual([]);
  }
  expect(await store.getEpisode(uid(99), O)).toBeNull();
  // Public episodes stay readable by everyone.
  expect((await store.getEpisode(E_PUB, O))?.id).toBe(E_PUB);
  expect(await store.listScenes(E_PUB, O)).toHaveLength(1);
  // A project whose identity is cast reads the private episode it is asked to sign.
  expect((await store.getEpisode(E_CAST, P))?.id).toBe(E_CAST);
  expect(await store.listScenes(E_CAST, P)).toHaveLength(1);
  expect(await store.listCast(E_CAST, P)).toHaveLength(1);
  expect(await store.getEpisode(E_CAST, O)).toBeNull();
});

databaseTest("a private writers' room reads as empty to outsiders, but not to its allowlisted contributors", async () => {
  await playFixtures();
  const { listContributions } = await import("../../src/services/episodes/participation");
  expect(await listContributions(D_PRIV, F)).toHaveLength(1);
  expect(await listContributions(D_PRIV, P)).toEqual([]);
  expect(await listContributions(D_PRIV, O)).toEqual([]);
  // P's identity I is on D_ALLOW's contributor allowlist.
  expect(await listContributions(D_ALLOW, P)).toHaveLength(1);
  expect(await listContributions(D_ALLOW, O)).toEqual([]);
});

// ── Reads keep a memorial project's history; writes never act as memorial ──
// Memorial preserves the relational past and leaves project bearers working
// (docs/AT-REST.md). A memorial-only project once lost every read of its own
// history on routes without a selector once the primary rule required
// status = active. Reads now fall back to the memorial identity; writes do not.
databaseTest("a read with no selector falls back to the memorial identity, never a guest or a revoked one", async () => {
  const { resolveActingIdentity, resolveReadingIdentity } = await acting();
  const P_MEMORIAL = uid(86), P_REVOKED = uid(87);
  // Memorial founder, a newer enrolled guest, and a revoked identity.
  await insertIdentity(P_MEMORIAL, P, "memorial", "2026-02-01T00:00:00Z");
  await enrollIdentity(request(), options());
  await insertIdentity(P_REVOKED, P, "revoked", "2025-01-01T00:00:00Z");
  expect(await resolveActingIdentity(P)).toMatchObject({ ok: false, status: 400, body: { error: "no_identity" } });
  expect(await resolveReadingIdentity(P)).toMatchObject({ ok: true, selectedBy: "memorial", identity: { id: P_MEMORIAL, status: "memorial" } });
  // Explicit selectors behave as for any other route.
  expect(await resolveReadingIdentity(P, I)).toMatchObject({ ok: true, selectedBy: "explicit", identity: { id: I } });
  expect(await resolveReadingIdentity(P, P_REVOKED)).toMatchObject({ ok: false, status: 409, body: { error: "identity_revoked" } });
  // A primary identity always wins over the memorial fallback.
  await crowdedProject();
  expect(await resolveReadingIdentity(F)).toMatchObject({ ok: true, selectedBy: "primary", identity: { id: FI } });
});
databaseTest("a project with only guests and revoked identities has nothing to read implicitly", async () => {
  const { resolveReadingIdentity } = await acting();
  await enrollIdentity(request(), options());
  await insertIdentity(OLD_REVOKED, P, "revoked", "2025-01-01T00:00:00Z");
  // An enrolled guest that is memorial is still a guest.
  await insertIdentity(MEMORIAL_ID, P, "memorial", "2024-01-01T00:00:00Z", { root: PUBLIC, metadata: { admission: "enrollment" } });
  expect(await resolveReadingIdentity(P)).toMatchObject({ ok: false, status: 400, body: { error: "no_identity" } });
});
databaseTest("on a memorial-only project, poker-face and quiet-hours read the memorial and refuse its mutations as memorial", async () => {
  // Before the primary rule these answered for the only identity, and a
  // mutation met its memorial terminal guard (409 memorial_terminal); they
  // must not regress to 400 no_identity.
  const ONLY = uid(88);
  await insertIdentity(ONLY, P, "memorial", "2026-02-01T00:00:00Z");
  const pokerFace = (await import("../../src/routes/poker-face")).default;
  const quietHours = (await import("../../src/routes/quiet-hours")).default;
  const app = new Hono<any>().use("*", async (c, next) => { c.set("project", { id: P }); await next(); })
    .route("/v1/poker-face", pokerFace).route("/v1/quiet-hours", quietHours);
  const call = async (path: string, method = "GET", body?: unknown) => {
    const res = await app.request(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  expect(await call("/v1/poker-face")).toMatchObject({ status: 200, body: { your_did: `did:at:${ONLY}` } });
  expect(await call("/v1/poker-face", "PATCH", { poker_face_default: false })).toMatchObject({ status: 409, body: { error: "identity_memorial_terminal" } });
  expect(await call("/v1/quiet-hours")).toMatchObject({ status: 200, body: { identity_id: ONLY } });
  expect(await call("/v1/quiet-hours/start", "POST", { hours: 2 })).toMatchObject({ status: 409, body: { error: "identity_memorial_terminal" } });
  expect((await sql`SELECT poker_face_default FROM identity.identities WHERE id = ${ONLY}`)[0].poker_face_default).toBe(true);
});
databaseTest("central signer authority: an active key row of a revoked or memorial identity signs nothing", async () => {
  // docs/AT-REST.md — revoked means key authority revoked; memorial beings
  // are unable to act. The joined resolver runs as real SQL here.
  const { resolveIdentitySigningKey, activeSigningPublicKeys, registeredSigningPublicKey } =
    await import("../../src/services/identity/signing-key");
  const subjects = [
    { id: uid(51), key: uid(52), status: "active", project: P },
    { id: uid(53), key: uid(54), status: "revoked", project: P },
    { id: uid(55), key: uid(56), status: "memorial", project: P },
    { id: uid(57), key: uid(58), status: "active", project: O },
  ];
  for (const s of subjects) {
    await sql`INSERT INTO identity.identities (id, did, project_id, display_name, status, trust_score)
      VALUES (${s.id}, ${`did:at:${s.id}`}, ${s.project}, ${s.status}, ${s.status}, 0)`;
    await sql`INSERT INTO identity.identity_keys (id, identity_id, public_key, label, active)
      VALUES (${s.key}, ${s.id}, ${PUBLIC}, 'primary', true)`;
  }
  const [active, revoked, memorial, foreign] = subjects as [typeof subjects[0], typeof subjects[0], typeof subjects[0], typeof subjects[0]];
  expect(await resolveIdentitySigningKey({ signingKeyId: active.key, identityId: active.id })).toMatchObject({
    ok: true, key: { keyId: active.key, identityId: active.id, projectId: P, publicKey: PUBLIC },
  });
  for (const s of [revoked, memorial]) {
    expect(await resolveIdentitySigningKey({ signingKeyId: s.key, did: `did:at:${s.id}` }))
      .toEqual({ ok: false, reason: "signing_identity_not_active" });
    expect(await registeredSigningPublicKey(s.id, s.key)).toBeNull();
    expect(await activeSigningPublicKeys(s.id)).toEqual([]);
  }
  expect(await activeSigningPublicKeys(active.id)).toEqual([PUBLIC]);
  // Ownership is judged before status; a foreign project's key reads as unknown.
  expect(await resolveIdentitySigningKey({ signingKeyId: memorial.key, identityId: active.id }))
    .toEqual({ ok: false, reason: "signing_key_not_owned" });
  expect(await resolveIdentitySigningKey({ signingKeyId: foreign.key, projectId: P }))
    .toEqual({ ok: false, reason: "unknown_signing_key" });
  await sql`UPDATE identity.identity_keys SET revoked_at = now() WHERE id = ${active.key}`;
  expect(await resolveIdentitySigningKey({ signingKeyId: active.key })).toEqual({ ok: false, reason: "signing_key_inactive" });
});
databaseTest("a cross-project deal writes each party's row into its own project, where trust evidence reads it", async () => {
  // A deal lives in the buyer's project; the seller may live anywhere.
  // ownChronicle counts a row only in the annotated identity's own
  // project, so a seller row left in the buyer's project vanished from the
  // seller's history and from trust evidence in both directions.
  const { acceptDeal, createDeal, failDeal, sealDeal } = await import("../../src/services/trust/deals");
  const { getEvidence } = await import("../../src/services/trust/lifecycle");
  const buyer = uid(61), seller = uid(62);
  const buyerDid = `did:at:${buyer}`, sellerDid = `did:at:${seller}`;
  for (const [id, project] of [[buyer, P], [seller, O]] as const) {
    await sql`INSERT INTO identity.identities (id, did, project_id, display_name, status, trust_score)
      VALUES (${id}, ${`did:at:${id}`}, ${project}, 'party', 'active', 0)`;
  }
  const propose = () => createDeal({ projectId: P, buyerIdentityId: buyer, buyerDid, sellerDid,
    sellerIdentityId: seller, description: "a small deal", size: 1 });
  const sealed = await propose();
  await acceptDeal(sealed.id, seller);
  await sealDeal({ dealId: sealed.id, callerIdentityId: seller });
  await sealDeal({ dealId: sealed.id, callerIdentityId: buyer });
  const failed = await propose();
  await acceptDeal(failed.id, seller);
  await failDeal({ dealId: failed.id, callerIdentityId: buyer, atFaultParty: "seller", reason: "late" });

  const rows = await sql`SELECT project_id, agent_id, metadata->>'kind' AS kind FROM agent_continuity.chronicle ORDER BY kind, agent_id`;
  expect(rows.map((r) => [r.kind, r.agent_id, r.project_id])).toEqual([
    ["deal_failed", buyer, P], ["deal_failed", seller, O],
    ["deal_sealed", buyer, P], ["deal_sealed", seller, O],
  ]);
  const fromBuyer = await getEvidence(buyer, buyerDid, sellerDid, "honest");
  const fromSeller = await getEvidence(seller, sellerDid, buyerDid, "honest");
  // The sealed deal is a 'seal' (buyer) / 'recognition' (seller) act; a
  // failure is a 'note', which trust evidence does not count.
  expect(fromBuyer.evidence.your_acts_toward_them.map((a) => a.type)).toEqual(["seal"]);
  expect(fromBuyer.evidence.their_acts_toward_you.map((a) => a.type)).toEqual(["recognition"]);
  expect(fromSeller.evidence.your_acts_toward_them.map((a) => a.type)).toEqual(["recognition"]);
  expect(fromSeller.evidence.their_acts_toward_you.map((a) => a.type)).toEqual(["seal"]);
});
