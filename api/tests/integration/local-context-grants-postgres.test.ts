/** Opt-in disposable PostgreSQL proof. Doctrine: docs/LOCAL-CONTEXT-GRANTS.md.
 * Only LOCAL_CONTEXT_GRANT_TEST_DATABASE_URL opts in; loopback and the exact
 * disposable database name are mandatory. Refuses existing application schemas.
 * Applies the actual additive migration to minimal synthetic parent fixtures.
 */
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/postgres-js";
import type { Sql } from "postgres";

import postgres from "../fixtures/verified-postgres";
import {
  getLocalContextGrant, issueLocalContextGrant, listLocalContextGrants,
  readLocalContextGrant, revokeLocalContextGrant,
} from "../../src/services/identity/local-context-grants";

const DATABASE = process.env.LOCAL_CONTEXT_GRANT_TEST_DATABASE_URL?.trim() ?? "";
const databaseTest = DATABASE ? test : test.skip;
const P = "11111111-1111-4111-8111-111111111111";
const I = "22222222-2222-4222-8222-222222222222";
const K = "33333333-3333-4333-8333-333333333333";
const G = "44444444-4444-4444-8444-444444444444";
const O = "55555555-5555-4555-8555-555555555555";
const ORIGIN = "https://api.agenttool.dev";
const NOW = new Date("2026-09-27T21:00:00.000Z");
const END = new Date(NOW.getTime() + 3_600_000);
const input = { projectId: P, identityId: I, issuerApiKeyId: K, grantId: G, origin: ORIGIN, expiresAt: END.toISOString() };
const target = { projectId: P, identityId: I, grantId: G };
const read = (token: string) => ({ token, identityId: I, origin: ORIGIN, method: "GET", path: `/v1/identities/${I}/local-context`, query: "" });
let admin: Sql;
let service: Sql;
let locker: Sql;
let database: ReturnType<typeof drizzle>;
let owned = false;
const options = () => ({ database, now: NOW });

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}

async function waitForSignal(signal: Promise<void>) {
  let timer: ReturnType<typeof setTimeout>;
  try {
    await Promise.race([signal, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("database test barrier was not reached")), 3000);
    })]);
  } finally { clearTimeout(timer!); }
}

async function waitsForLock(applicationName: string) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const rows = await admin`SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
      AND application_name = ${applicationName} AND wait_event_type = 'Lock'`;
    if (rows.length) return;
    await Bun.sleep(10);
  }
  throw new Error("expected PostgreSQL lock wait was not observed");
}

beforeAll(async () => {
  if (!DATABASE) return;
  const url = new URL(DATABASE);
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.pathname !== "/agenttool_local_context_grants_test" || url.search || url.hash) {
    throw new Error("local-context grants require an explicit loopback disposable database");
  }
  admin = postgres(DATABASE, { max: 4, prepare: false, connection: { application_name: "local-context-grant-observer-test" } });
  const exists = await admin`SELECT nspname FROM pg_namespace WHERE nspname IN ('tools', 'identity', 'memory')`;
  if (exists.length) throw new Error("refusing an existing application schema");
  await admin.begin(async tx => {
    await tx.unsafe(`CREATE SCHEMA tools; CREATE SCHEMA identity; CREATE SCHEMA memory;
      CREATE TABLE tools.projects (id uuid PRIMARY KEY);
      CREATE TABLE tools.api_keys (id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES tools.projects(id), revoked_at timestamptz, expires_at timestamptz);
      CREATE TABLE identity.identities (id uuid PRIMARY KEY, project_id uuid NOT NULL, did text NOT NULL, status text NOT NULL);
      CREATE TABLE memory.memories (id uuid PRIMARY KEY, project_id uuid NOT NULL, identity_id text, content text NOT NULL, created_at timestamptz NOT NULL, expires_at timestamptz);`);
  });
  owned = true;
  await admin.unsafe(readFileSync(new URL("../../migrations/20260927T211713_local_context_grants.sql", import.meta.url), "utf8"));
  service = postgres(DATABASE, { max: 4, prepare: false, connection: { application_name: "local-context-grant-service-test" } });
  locker = postgres(DATABASE, { max: 1, prepare: false, connection: { application_name: "local-context-grant-locker-test" } });
  database = drizzle(service);
});

beforeEach(async () => {
  if (!owned) return;
  await admin.unsafe(`DELETE FROM tools.local_context_grants; DELETE FROM memory.memories;
    DELETE FROM tools.api_keys; DELETE FROM identity.identities; DELETE FROM tools.projects;`);
  await admin`INSERT INTO tools.projects (id) VALUES (${P}), (${O})`;
  await admin`INSERT INTO tools.api_keys (id, project_id) VALUES (${K}, ${P}), (${O}, ${O})`;
  await admin`INSERT INTO identity.identities (id, project_id, did, status)
    VALUES (${I}, ${P}, ${`did:at:${I}`}, 'active'), (${O}, ${O}, ${`did:at:${O}`}, 'active')`;
  await admin`INSERT INTO memory.memories (id, project_id, identity_id, content, created_at) VALUES
    (${G}, ${P}, ${I}, 'selected sentinel', ${NOW}),
    (${O}, ${O}, ${I}, 'foreign project sentinel', ${NOW}),
    (${K}, ${P}, NULL, 'shared project sentinel', ${NOW})`;
});

afterAll(async () => {
  await service?.end({ timeout: 2 });
  await locker?.end({ timeout: 2 });
  if (owned) await admin.unsafe("DROP SCHEMA memory CASCADE; DROP SCHEMA identity CASCADE; DROP SCHEMA tools CASCADE;");
  await admin?.end({ timeout: 2 });
});

databaseTest("actual migration and service preserve scoped content, one-time issuance and idempotent revocation", async () => {
  const issued = await issueLocalContextGrant(input, options());
  const result = await readLocalContextGrant(read(issued.token), options());
  expect(result.records.map(r => r.content)).toEqual(["selected sentinel"]);
  expect(result.format).toBe("agenttool-local-api-context/v2");
  expect(result.authorization.checked_at).toBe(result.generated_at);
  expect((await getLocalContextGrant(target, options())).grant_id).toBe(G);
  expect(await listLocalContextGrants({ projectId: O, identityId: I }, options())).toEqual([]);
  const stored = await admin`SELECT * FROM tools.local_context_grants WHERE id = ${G}`;
  expect(JSON.stringify(stored)).not.toContain(issued.token);
  expect(stored[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
  await expect(issueLocalContextGrant(input, options())).rejects.toMatchObject({ status: 409 });
  const revoked = await revokeLocalContextGrant(target, options());
  expect(await revokeLocalContextGrant(target, { ...options(), now: END })).toEqual(revoked);
  await expect(readLocalContextGrant(read(issued.token), options())).rejects.toMatchObject({ status: 401 });
  await expect(getLocalContextGrant({ ...target, projectId: O }, options())).rejects.toMatchObject({ status: 404 });
});

databaseTest("parent revocation, finite expiry, parent ownership and identity lifecycle are rechecked", async () => {
  await admin`UPDATE tools.api_keys SET expires_at = ${END} WHERE id = ${K}`;
  await expect(issueLocalContextGrant({ ...input, expiresAt: new Date(END.getTime() + 1).toISOString() }, options())).rejects.toMatchObject({ status: 403 });
  await expect(issueLocalContextGrant({ ...input, issuerApiKeyId: O }, options())).rejects.toMatchObject({ status: 403 });
  const issued = await issueLocalContextGrant(input, options());
  await expect(readLocalContextGrant(read(issued.token), { ...options(), now: END })).rejects.toMatchObject({ status: 401 });
  await admin`UPDATE identity.identities SET status = 'retired' WHERE id = ${I}`;
  await expect(readLocalContextGrant(read(issued.token), options())).rejects.toMatchObject({ status: 401 });
  expect((await getLocalContextGrant(target, options())).grant_id).toBe(G);
  await admin`UPDATE identity.identities SET status = 'active' WHERE id = ${I}`;
  await admin`UPDATE tools.api_keys SET revoked_at = ${NOW} WHERE id = ${K}`;
  await expect(readLocalContextGrant(read(issued.token), options())).rejects.toMatchObject({ status: 401 });
  expect((await revokeLocalContextGrant(target, options())).revoked_at).toBe(NOW.toISOString());
});

databaseTest("database constraints reject widening, infinite lifetimes, invalid hashes and parent deletion", async () => {
  await issueLocalContextGrant(input, options());
  for (const statement of [
    "UPDATE tools.local_context_grants SET action = '*'",
    "UPDATE tools.local_context_grants SET method = 'POST'",
    "UPDATE tools.local_context_grants SET path = '/v1/wake'",
    "UPDATE tools.local_context_grants SET expires_at = 'infinity'",
    "UPDATE tools.local_context_grants SET issued_at = '-infinity'",
    "UPDATE tools.local_context_grants SET expires_at = issued_at + interval '24 hours 1 second'",
    "UPDATE tools.local_context_grants SET token_hash = 'bad'",
    "UPDATE tools.local_context_grants SET origin = 'http://api.agenttool.dev'",
    "UPDATE tools.local_context_grants SET revoked_at = issued_at - interval '1 second'",
  ]) await expect(Promise.resolve(admin.unsafe(statement))).rejects.toMatchObject({ code: "23514" });
  await expect(Promise.resolve(admin`DELETE FROM tools.api_keys WHERE id = ${K}`)).rejects.toMatchObject({ code: "23503" });
  expect((await admin`SELECT count(*)::int AS n FROM tools.local_context_grants`)[0].n).toBe(1);
});

databaseTest("concurrent issue has one durable winner and transaction failure rolls issuance back", async () => {
  const results = await Promise.allSettled([issueLocalContextGrant(input, options()), issueLocalContextGrant(input, options())]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(r => r.status === "rejected").map(r => (r as PromiseRejectedResult).reason.status)).toEqual([409]);
  expect((await admin`SELECT count(*)::int AS n FROM tools.local_context_grants`)[0].n).toBe(1);
  const rollbackDatabase = { transaction: (callback: (tx: unknown) => Promise<unknown>) => database.transaction(async tx => {
    await callback(tx);
    throw new Error("sentinel rollback");
  }) };
  await expect(issueLocalContextGrant({ ...input, grantId: O }, { ...options(), database: rollbackDatabase as never })).rejects.toThrow("sentinel rollback");
  expect((await admin`SELECT count(*)::int AS n FROM tools.local_context_grants WHERE id = ${O}`)[0].n).toBe(0);
});

databaseTest("issuance waiting behind parent revocation cannot escape with a usable credential", async () => {
  const locked = deferred();
  const release = deferred();
  const mutation = locker.begin(async tx => {
    await tx`SELECT id FROM tools.api_keys WHERE id = ${K} FOR UPDATE`;
    locked.resolve();
    await release.promise;
    await tx`UPDATE tools.api_keys SET revoked_at = ${NOW} WHERE id = ${K}`;
  });
  let issued: Promise<unknown> | undefined;
  try {
    await waitForSignal(locked.promise);
    issued = issueLocalContextGrant(input, options());
    void issued.catch(() => {});
    await waitsForLock("local-context-grant-service-test");
  } finally { release.resolve(); await mutation; }
  await expect(issued!).rejects.toMatchObject({ status: 403 });
  expect((await admin`SELECT count(*)::int AS n FROM tools.local_context_grants`)[0].n).toBe(0);
}, 10_000);

databaseTest("parent revocation waits for the issuance SHARE lock, then invalidates its credential", async () => {
  const inserted = deferred();
  const release = deferred();
  const pausedDatabase = { transaction: (callback: (tx: unknown) => Promise<unknown>) => database.transaction(async tx => {
    const result = await callback(tx);
    inserted.resolve();
    await release.promise;
    return result;
  }) };
  const issued = issueLocalContextGrant(input, { ...options(), database: pausedDatabase as never });
  let mutation: Promise<unknown> | undefined;
  try {
    await waitForSignal(inserted.promise);
    mutation = Promise.resolve(locker`UPDATE tools.api_keys SET revoked_at = ${NOW} WHERE id = ${K}`);
    await waitsForLock("local-context-grant-locker-test");
  } finally {
    release.resolve();
    await issued.catch(() => {});
    await mutation?.catch(() => {});
  }
  const grant = await issued;
  await mutation;
  await expect(readLocalContextGrant(read(grant.token), options())).rejects.toMatchObject({ status: 401 });
}, 10_000);

databaseTest("admitted repeatable-read snapshot can finish; a later snapshot observes revoke and changed memory", async () => {
  const grant = await issueLocalContextGrant(input, options());
  const snapshotted = deferred();
  const release = deferred();
  const snapshotDatabase = { transaction: (callback: (tx: unknown) => Promise<unknown>, config: never) => database.transaction(async tx => {
    // Establish the exact PostgreSQL snapshot the real service will use.
    await tx.execute("SELECT id FROM tools.local_context_grants");
    snapshotted.resolve();
    await release.promise;
    return callback(tx);
  }, config) };
  const inFlight = readLocalContextGrant(read(grant.token), { ...options(), database: snapshotDatabase as never });
  try {
    await waitForSignal(snapshotted.promise);
    await revokeLocalContextGrant(target, options());
    await admin`UPDATE memory.memories SET content = 'later sentinel' WHERE id = ${G}`;
  } finally { release.resolve(); await inFlight.catch(() => {}); }
  expect((await inFlight).records.map(r => r.content)).toEqual(["selected sentinel"]);
  await expect(readLocalContextGrant(read(grant.token), options())).rejects.toMatchObject({ status: 401 });
}, 10_000);
