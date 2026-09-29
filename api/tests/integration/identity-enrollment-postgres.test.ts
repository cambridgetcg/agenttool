/** Actual SQL uniqueness and rollback; only an explicit empty loopback test DB.
 * Never falls back to DATABASE_URL or existing application schemas. */
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as ed from "@noble/ed25519";
import { drizzle } from "drizzle-orm/postgres-js";
import type { Sql } from "postgres";
import postgres from "../fixtures/verified-postgres";
import { canonicalIdentityEnrollmentBytes, enrollIdentity } from "../../src/services/identity/enrollment";

const DATABASE = process.env.IDENTITY_ENROLLMENT_TEST_DATABASE_URL?.trim() ?? "";
const databaseTest = DATABASE ? test : test.skip;
const uid = (n: number) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
const P = uid(1), I = uid(2), K = uid(3), A = uid(4), O = uid(5);
const NOW = new Date("2026-09-29T12:00:00.000Z"), ORIGIN = "https://api.agenttool.dev";
const PRIVATE = new Uint8Array(32).fill(7), PUBLIC = Buffer.from(ed.getPublicKey(PRIVATE)).toString("base64");
let sql: Sql, database: ReturnType<typeof drizzle>, owned = false;
function request(overrides: Record<string, unknown> = {}) {
  const body = { format: "agenttool-identity-enrollment/v1", origin: ORIGIN, project_id: P, identity_id: I,
    signing_key_id: K, display_name: "Selected participant", capabilities: [], public_key: PUBLIC,
    nonce: Buffer.alloc(32, 8).toString("base64url"), timestamp: NOW.toISOString(), ...overrides };
  const input = { origin: ORIGIN, projectId: P, issuerApiKeyId: A, bodyBytes: Buffer.from(JSON.stringify(body)), signature: "" };
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
    CREATE TABLE tools.api_keys (id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES tools.projects(id), revoked_at timestamptz, expires_at timestamptz);
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
  database = drizzle(sql);
});
beforeEach(async () => {
  if (!owned) return;
  await sql.unsafe("ALTER TABLE identity.identity_keys DROP CONSTRAINT IF EXISTS fixture_key_failure; DELETE FROM identity.identity_keys; DELETE FROM identity.identities; DELETE FROM identity.registration_proofs; DELETE FROM tools.api_keys; DELETE FROM tools.projects;");
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
